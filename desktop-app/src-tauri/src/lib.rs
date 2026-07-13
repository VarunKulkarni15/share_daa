use tauri::Manager;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use futures_util::{StreamExt, SinkExt};

#[tauri::command]
fn check_vpn_status() -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("tasklist").output() {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("tailscale.exe") || 
               stdout.contains("openvpn.exe") || 
               stdout.contains("wireguard.exe") || 
               stdout.contains("vpnui.exe") || 
               stdout.contains("nordvpn.exe") || 
               stdout.contains("expressvpn.exe") || 
               stdout.contains("surfshark.exe") || 
               stdout.contains("mullvad.exe") {
                   return true;
            }
        }
    }
    
    // On other platforms, fallback to a simplified check if needed, or false.
    false
}

#[tauri::command]
fn get_local_ip() -> String {
    if let Ok(ip) = local_ip_address::local_ip() {
        ip.to_string()
    } else {
        "127.0.0.1".to_string()
    }
}

#[tauri::command]
fn open_browser_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|_app| {
        tauri::async_runtime::spawn(async move {
            let addr = "0.0.0.0:5174";
            if let Ok(listener) = TcpListener::bind(&addr).await {
                let clients = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
                let next_client_id = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

                while let Ok((stream, _)) = listener.accept().await {
                    let clients = clients.clone();
                    let next_client_id = next_client_id.clone();

                    tauri::async_runtime::spawn(async move {
                        if let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await {
                            let (mut write, mut read) = ws_stream.split();
                            let (tx, mut rx) = tokio::sync::mpsc::channel::<tokio_tungstenite::tungstenite::Message>(100);
                            let my_id = next_client_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                            clients.lock().await.push((my_id, tx));

                            let mut send_task = tauri::async_runtime::spawn(async move {
                                while let Some(msg) = rx.recv().await {
                                    if write.send(msg).await.is_err() {
                                        break;
                                    }
                                }
                            });

                            let clients_ref = clients.clone();
                            let mut recv_task = tauri::async_runtime::spawn(async move {
                                while let Some(Ok(msg)) = read.next().await {
                                    match msg {
                                        tokio_tungstenite::tungstenite::Message::Text(_) |
                                        tokio_tungstenite::tungstenite::Message::Binary(_) => {
                                            let mut locked = clients_ref.lock().await;
                                            // Retain only connected clients and send msg
                                            let mut i = 0;
                                            while i < locked.len() {
                                                if locked[i].0 != my_id {
                                                    if locked[i].1.send(msg.clone()).await.is_err() {
                                                        locked.remove(i);
                                                    } else {
                                                        i += 1;
                                                    }
                                                } else {
                                                    i += 1;
                                                }
                                            }
                                        },
                                        _ => {}
                                    }
                                }
                            });

                            tokio::select! {
                                _ = (&mut send_task) => recv_task.abort(),
                                _ = (&mut recv_task) => send_task.abort(),
                            };
                        }
                    });
                }
            }
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![check_vpn_status, get_local_ip, open_browser_url])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
