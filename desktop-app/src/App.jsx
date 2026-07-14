import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Users, ArrowLeft, Wifi, QrCode as QrCodeIcon, Plus, UploadCloud, Share2, Link, AlertTriangle, Download, X } from 'lucide-react';
import { QRCode } from 'react-qrcode-logo';
import { invoke } from '@tauri-apps/api/core';
import './index.css';

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getFileIconSrc = (filename) => {
  if (!filename) return '/icon-code.png';
  const ext = filename.split('.').pop().toLowerCase();
  if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return '/icon-game.png';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '/icon-video.png';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return '/icon-audio.png';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return '/icon-video.png'; // No image icon, using video as fallback
  return '/icon-code.png';
};

const APP_VERSION = "1.0.0";

function App() {
  const [universalPin] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [isVPNActive, setIsVPNActive] = useState(false);
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [clientId] = useState(() => 'desktop-' + Math.random().toString(36).substr(2, 9));
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('bridgedeck_history');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return [];
  });
  const [toastMessage, setToastMessage] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [showPolicyPopup, setShowPolicyPopup] = useState(false);

  const addDebugLog = (log) => {
    setDebugLogs(prev => [...prev.slice(-9), new Date().toISOString().split('T')[1].slice(0, -1) + " " + log]);
  };

  const [pinDigits, setPinDigits] = useState(['', '', '', '']);
  const pinRefs = [useRef(), useRef(), useRef(), useRef()];

  const [ws, setWs] = useState(null);

  const [currentView, setCurrentView] = useState('main');
  const [beamState, setBeamState] = useState('setup');
  const [hubState, setHubState] = useState('setup');
  const [stagedFiles, setStagedFiles] = useState([]);
  const [showSplash, setShowSplash] = useState(true);
  const [updateInfo, setUpdateInfo] = useState(null);

  useEffect(() => {
    // Check for forced updates on launch
    fetch('https://sharedaa.varunkulkarni.dpdns.org/version.json')
      .then(res => res.json())
      .then(data => {
        if (data.latest_version && data.latest_version !== APP_VERSION && data.force_update) {
          setUpdateInfo(data);
        } else if (data.latest_version && data.latest_version !== APP_VERSION) {
          setTimeout(() => showToast(`Update available: ${data.latest_version}. Check MS Store!`), 5000);
        }
      }).catch(e => console.log("Update check failed (offline)", e));

    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Refs for logic decoupled from UI
  const sessionIdRef = useRef(null);
  const isConnectedRef = useRef(false);
  const fileChunksRef = useRef({}); // Memory store for chunks (fallback)
  const fileStreamsRef = useRef({}); // OPFS streams
  const chunkQueue = useRef({}); // Sequential processing queue
  const cancelledTransfers = useRef(new Set());
  const nextBinaryMetaRef = useRef(null);
  const transferStartTimes = useRef({});
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('bridgedeck_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return {
      deviceName: "victno",
      discoverable: true,
      autoAccept: false,
      performanceMode: false,
    };
  });

  const settingsRef = useRef(settings);
  useEffect(() => {
    localStorage.setItem('bridgedeck_settings', JSON.stringify(settings));
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const history = messages.filter(m => m.status === 'completed' || m.status === 'cancelled').map(m => {
      const { _rawFile, ...rest } = m;
      return rest;
    });
    localStorage.setItem('bridgedeck_history', JSON.stringify(history));
  }, [messages]);

  useEffect(() => {
    // Disable app refresh, dev tools, and right click context menu
    const handleKeyDown = (e) => {
      if (e.key === 'F12' || e.key === 'F5') e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) e.preventDefault();
    };
    const handleContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  useEffect(() => {
    const hasSeenPolicy = localStorage.getItem('policy_seen');
    if (!hasSeenPolicy) {
      setTimeout(() => setShowPolicyPopup(true), 4500); // 4.5 seconds to ensure splash is gone
    }
  }, []);

  const [avatarUrl, setAvatarUrl] = useState('/icon-avatar.png');
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    const checkVpn = async () => {
      try {
        const vpnStatus = await invoke('check_vpn_status');
        setIsVPNActive(vpnStatus);
        const ip = await invoke('get_local_ip');
        setLocalIp(ip);
      } catch (e) {
        console.error('Failed to check VPN status or IP:', e);
      }
    };
    checkVpn();

    const socket = new WebSocket('ws://localhost:5174/ws');
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => console.log('Connected to Rust WebSocket relay');
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        const meta = nextBinaryMetaRef.current;
        if (!meta) return;
        if (cancelledTransfers.current.has(meta.fileId)) return;

        const processChunk = async () => {
          if (meta.chunkIndex === 0) {
            transferStartTimes.current[meta.fileId] = Date.now();
          }

          const chunks = fileChunksRef.current[meta.fileId] || [];
          chunks[meta.chunkIndex] = e.data;
          fileChunksRef.current[meta.fileId] = chunks;

          let justCompleted = false;
          setMessages(prev => {
            const m = prev.find(item => item.id === meta.fileId);
            if (m) {
              const newProgress = Math.round(((meta.chunkIndex + 1) / meta.totalChunks) * 100);
              const isCompleted = (meta.chunkIndex + 1) === meta.totalChunks;
              if (isCompleted && m.status !== 'completed') justCompleted = true;
              if (newProgress >= m.progress + 2 || isCompleted) {
                return prev.map(m2 => m2.id === meta.fileId ? { ...m2, status: isCompleted ? 'completed' : 'receiving', received: meta.chunkIndex + 1, progress: newProgress } : m2);
              }
            } else {
              const isCompleted = meta.totalChunks === 1;
              if (isCompleted) justCompleted = true;
              return [...prev, {
                id: meta.fileId, batchId: meta.batchId, sessionId: sessionIdRef.current,
                name: meta.fileName, size: meta.fileSize, total: meta.totalChunks,
                type: 'incoming', status: isCompleted ? 'completed' : 'receiving',
                received: 1, progress: isCompleted ? 100 : 0, timestamp: Date.now()
              }];
            }
            return prev;
          });

          if (justCompleted) {
            const durationMs = Date.now() - (transferStartTimes.current[meta.fileId] || Date.now());
            const seconds = (durationMs / 1000).toFixed(2);
            addDebugLog(`🚀 ${meta.fileName} (${formatBytes(meta.fileSize)}) arrived in ${seconds}s`);

            if (settingsRef.current.autoAccept) {
              setTimeout(() => {
                saveFile({ id: meta.fileId, name: meta.fileName, saved: false });
              }, 500);
            }
          }
        };

        chunkQueue.current[meta.fileId] = (chunkQueue.current[meta.fileId] || Promise.resolve())
          .then(processChunk)
          .catch(e => console.error("Chunk processing error:", e));

        return;
      }

      let data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (data.payload && data.payload.senderId === clientId) return;

      if (data.event === 'file-chunk-meta') {
        nextBinaryMetaRef.current = data.payload;
        return;
      }

      if (data.event === 'join-beam') {
        if (String(data.payload.pin) !== String(universalPin)) {
          // Ignore it quietly. It might be meant for another desktop tab!
          return;
        }
        if (isConnectedRef.current) {
          // Room is locked! We already have a partner.
          socket.send(JSON.stringify({ event: 'join-error', payload: 'The host is already connected to another device.' }));
          return;
        }
        isConnectedRef.current = true;
        setBeamState('connected');
        sessionIdRef.current = 'session-' + Date.now();
        socket.send(JSON.stringify({ event: 'join-success', payload: { sessionId: sessionIdRef.current, desktopName: settingsRef.current.deviceName } }));
        showToast("Device connected successfully!");
      } else if (data.event === 'join-success') {
        isConnectedRef.current = true;
        setBeamState('connected');
        if (data.payload && data.payload.sessionId) {
          sessionIdRef.current = data.payload.sessionId;
        }
        showToast("Connected to device successfully!");
      } else if (data.event === 'join-error') {
        showToast(data.payload || "Connection error.");
      } else if (data.event === 'disconnect-beam') {
        isConnectedRef.current = false;
        setBeamState('setup');
        sessionIdRef.current = null;
        showToast("Session ended by the other device.");
      } else if (data.event === 'cancel-transfer') {
        const fileId = data.payload;
        cancelledTransfers.current.add(fileId);
        setMessages(prev => prev.map(m => m.id === fileId ? { ...m, status: 'cancelled' } : m));
      }
    };
    setWs(socket);

    const handleBeforeUnload = () => {
      if (socket && socket.readyState === WebSocket.OPEN && isConnectedRef.current) {
        socket.send(JSON.stringify({ event: 'disconnect-beam', payload: {} }));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      socket.close();
    };
  }, []);

  const sendFiles = async (filesArray) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const batchId = 'batch-' + Date.now();

    const newMessages = filesArray.map(file => ({
      id: 'msg-' + Math.random().toString(36).substr(2, 9),
      batchId,
      sessionId: sessionIdRef.current,
      type: 'outgoing',
      name: file.name,
      size: file.size,
      total: Math.ceil(file.size / (1 * 1024 * 1024)),
      received: 0,
      progress: 0,
      status: 'sending',
      timestamp: Date.now(),
      _rawFile: file
    }));

    setMessages(prev => [...prev, ...newMessages]);

    for (let msg of newMessages) {
      const file = msg._rawFile;
      const CHUNK_SIZE = 1 * 1024 * 1024;
      const totalChunks = msg.total;

      for (let i = 0; i < totalChunks; i++) {
        if (cancelledTransfers.current.has(msg.id)) break;
        const start = i * CHUNK_SIZE;
        const chunkDataBuffer = await file.slice(start, start + CHUNK_SIZE).arrayBuffer();

        // Wait if buffer is over 2MB to perfectly sync UI progress with actual Wi-Fi network speed
        while (ws.bufferedAmount > 2 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 20));
        }

        ws.send(JSON.stringify({
          event: 'file-chunk-meta',
          payload: {
            senderId: clientId, fileId: msg.id, batchId, chunkIndex: i, totalChunks,
            fileName: file.name, fileType: file.type, fileSize: file.size
          }
        }));
        ws.send(chunkDataBuffer);

        while (ws.bufferedAmount > 10 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 20));
        }

        setMessages(prev => {
          const m = prev.find(item => item.id === msg.id);
          if (m) {
            const newProgress = Math.round(((i + 1) / totalChunks) * 100);
            const isCompleted = (i + 1) === totalChunks;
            if (newProgress >= m.progress + 2 || isCompleted) {
              return prev.map(m2 => m2.id === msg.id ? {
                ...m2, received: i + 1, progress: newProgress,
                status: isCompleted ? 'completed' : 'sending'
              } : m2);
            }
          }
          return prev;
        });

        if (ws.current && ws.current.bufferedAmount > 10 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 10));
        } else if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, 1));
        }
      }
    }
  };

  const saveFile = async (msg) => {
    if (msg.saved) return;
    const chunks = fileChunksRef.current[msg.id];

    if (!chunks) {
      showToast("File data not found. Session may have been cleared.");
      return;
    }

    try {
      const blobOrFile = new Blob(chunks, { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blobOrFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = msg.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, saved: true } : m));
      showToast("File saved successfully!");
    } catch (e) {
      if (e.name !== 'AbortError') showToast("Error saving file: " + e.message);
    }
  };

  const saveAllFiles = async (batch) => {
    const unSaved = batch.files.filter(f => !f.saved);
    if (unSaved.length === 0) return;

    try {
      if ('showDirectoryPicker' in window) {
        // Ask for a directory once
        const dirHandle = await window.showDirectoryPicker({
          mode: 'readwrite'
        });
        
        // Save each file silently into the chosen directory
        for (const msg of unSaved) {
          const chunks = fileChunksRef.current[msg.id];
          if (!chunks) continue;
          
          const blobOrFile = new Blob(chunks, { type: 'application/octet-stream' });
          const fileHandle = await dirHandle.getFileHandle(msg.name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blobOrFile);
          await writable.close();
          
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, saved: true } : m));
        }
        showToast("All files saved successfully!");
      } else {
        // Fallback
        let delay = 0;
        for (const msg of unSaved) {
          setTimeout(() => saveFile(msg), delay);
          delay += 800; // stagger downloads slightly
        }
        showToast("All files saved successfully!");
      }
    } catch (e) {
      if (e.name !== 'AbortError') showToast("Error saving files: " + e.message);
    }
  };

  useEffect(() => {
    const handleGlobalDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleGlobalDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleGlobalDrop = (e) => {
      e.preventDefault();
      setIsDragging(false);
      if (beamState === 'connected' && e.dataTransfer.files.length > 0) {
        setStagedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
      }
    };
    window.addEventListener('dragover', handleGlobalDragOver);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);
    return () => {
      window.removeEventListener('dragover', handleGlobalDragOver);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [beamState]);

  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); setStagedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleFileSelect = (e) => { if (e.target.files.length > 0) { setStagedFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = ''; } };

  const confirmAndSend = () => {
    if (stagedFiles.length > 0) {
      sendFiles(stagedFiles);
      setStagedFiles([]);
    }
  };

  const cancelTransfer = (fileId) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'cancel-transfer', payload: fileId }));
    }
    cancelledTransfers.current.add(fileId);
    setMessages(prev => prev.map(m => m.id === fileId ? { ...m, status: 'cancelled' } : m));
  };

  const handlePinChange = (index, value) => {
    const val = value.replace(/[^0-9]/g, '');
    if (val.length > 1) return;
    const newDigits = [...pinDigits];
    newDigits[index] = val;
    setPinDigits(newDigits);

    if (val && index < 3) pinRefs[index + 1].current.focus();
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinRefs[index - 1].current.focus();
    }
  };

  const disconnectSession = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'disconnect-beam', payload: {} }));
    }
    setBeamState('setup');
    setHubState('setup');
    isConnectedRef.current = false;
    sessionIdRef.current = null;
    setPinDigits(['', '', '', '']);
    showToast("Session ended.");
  };

  const handleNavClick = (view) => {
    if (beamState === 'connected' || hubState === 'connected') {
      showToast('Please disconnect your current session to navigate.');
      return;
    }
    setCurrentView(view);
  };

  // Group messages into batches for display
  const sessionMessages = messages.filter(m => m.sessionId === sessionIdRef.current);

  const groupedSessionBatches = useMemo(() => {
    const batchesMap = new Map();
    sessionMessages.forEach(msg => {
      if (!batchesMap.has(msg.batchId)) {
        batchesMap.set(msg.batchId, { batchId: msg.batchId, type: msg.type, timestamp: msg.timestamp, files: [], status: 'completed' });
      }
      const batch = batchesMap.get(msg.batchId);
      batch.files.push(msg);
      if (msg.status !== 'completed') batch.status = 'transferring';
    });
    return Array.from(batchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [sessionMessages]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: '#1E1E1E',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Cal Sans", sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400;500;600;700;800&display=swap');

        @keyframes liveGradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes floatAvatar {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
          100% { transform: translateY(0px); }
        }

        .figma-canvas {
          position: relative;
          width: 100vw;
          height: 100vh;
          background: #C8D6C8;
          overflow: hidden;
        }

        .bubbles-1 { position: absolute; width: 796px; height: 806px; left: -100px; top: -50px; background: url('/bubbles-1.png'); background-size: 100% 100%; pointer-events: none; z-index: 0; }
        .bubbles { position: absolute; width: 1013px; height: 982px; right: -200px; bottom: -100px; background: url('/bubbles.png'); background-size: 100% 100%; pointer-events: none; z-index: 0; }

        .dashboard-layout {
          position: relative;
          z-index: 10;
          display: flex;
          gap: clamp(12px, 2.5vw, 32px);
          padding: clamp(16px, 3.5vw, 48px);
          height: 100%;
          box-sizing: border-box;
          max-width: 1600px;
          margin: 0 auto;
        }

        /* --- LIQUID GLASS PANELS --- */
        .glass-sidebar { 
          background: rgba(28, 49, 37, 0.4); 
          backdrop-filter: blur(40px); 
          -webkit-backdrop-filter: blur(40px);
          border-radius: 32px; 
          padding: clamp(20px, 3vw, 40px) clamp(16px, 2.5vw, 32px); 
          width: clamp(160px, 22vw, 320px); 
          flex-shrink: 0;
          display: flex; 
          flex-direction: column; 
          border: 1px solid rgba(255,255,255,0.15); 
          box-shadow: 0 16px 40px rgba(0,0,0,0.1); 
        }
        
        .glass-main { 
          background: rgba(255, 255, 255, 0.4); 
          backdrop-filter: blur(40px); 
          -webkit-backdrop-filter: blur(40px);
          border-radius: 32px; 
          padding: clamp(20px, 3vw, 40px) clamp(20px, 3.5vw, 48px); 
          flex-grow: 1; 
          min-width: 0;
          display: flex; 
          flex-direction: column; 
          overflow-y: auto; 
          border: 1px solid rgba(255,255,255,0.4); 
          box-shadow: 0 16px 40px rgba(0,0,0,0.05); 
        }

        .setup-card {
          border-radius: 32px !important;
          padding: 64px 40px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          text-align: center !important;
          overflow: hidden !important;
          isolation: isolate;
          will-change: transform;
          transform: translateZ(0);
          -webkit-mask-image: -webkit-radial-gradient(white, black);
        }

        .text-beam { color: #FFFFFF; }
        .text-hub { color: #1C3125; }
        .text-beam-muted { color: rgba(255,255,255,0.7); }
        .text-hub-muted { color: #8c8266; }

        /* --- SIDEBAR COMPONENTS --- */
        .sidebar-profile { display: flex; align-items: center; gap: clamp(10px, 1.5vw, 20px); margin-bottom: clamp(24px, 4vw, 64px); position: relative; flex-wrap: wrap; }
        .sidebar-profile img { width: clamp(44px, 5.5vw, 72px); height: clamp(44px, 5.5vw, 72px); border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.8); box-shadow: 0 8px 16px rgba(0,0,0,0.1); object-fit: cover; animation: floatAvatar 4s ease-in-out infinite; cursor: pointer; transition: 0.2s; }
        .sidebar-profile img:hover { transform: scale(1.05); }
        .sidebar-profile div h3 { margin: 0; font-size: clamp(16px, 2vw, 28px); letter-spacing: -0.5px; }
        .sidebar-profile div p { margin: 4px 0 0 0; font-size: clamp(13px, 1.2vw, 16px); font-family: 'Inter', sans-serif; }

        .nav-link { display: flex; align-items: center; gap: 16px; padding: clamp(8px, 1vw, 12px) clamp(12px, 1.5vw, 20px); border-radius: 12px; font-size: clamp(14px, 1.6vw, 20px); cursor: pointer; margin-bottom: 12px; transition: 0.2s; font-family: 'Cal Sans', sans-serif; color: #FFFFFF; }
        .nav-link.active { background: rgba(255,255,255,0.2); }
        .nav-link:hover:not(.active) { background: rgba(255, 255, 255, 0.1); }

        /* --- MAIN CONTENT PANELS --- */
        .header-title { font-size: clamp(22px, 4vw, 56px); margin: 0 0 clamp(16px, 3vw, 48px) 0; letter-spacing: -0.5px; color: #1C3125; text-shadow: 0 4px 12px rgba(255,255,255,0.3); }

        /* 3D CARDS ROW */
        .cards-row { display: flex; gap: clamp(16px, 3.5vw, 48px); margin-bottom: 24px; flex-wrap: wrap; }
        .figma-card { position: relative; width: clamp(160px, 30vw, 370px); height: clamp(120px, 22vw, 270px); cursor: pointer; transition: transform 0.2s ease; flex-shrink: 0; }
        .figma-card:hover { transform: translateY(-8px); }
        .figma-card .rect-shadow { position: absolute; left: 0; right: 0; bottom: 0; top: 1.95%; background: #FFFFFF; box-shadow: 0px 4px 31px rgba(0, 0, 0, 0.27); border-radius: 18px; }
        .figma-card .rect-gradient { position: absolute; left: 0; right: 0; top: 0; bottom: 1.95%; border-radius: 18px; }
        .card-bg-beam { background: linear-gradient(-45deg, #779070, #1C3125, #4D6948, #2a4a38); background-size: 300% 300%; }
        .card-bg-hub { background: linear-gradient(-45deg, #EAE2CA, #A29777, #d4caab, #8c8266); background-size: 300% 300%; }

        /* PERFORMANCE MODE */
        .perf-mode * { animation: none !important; }
        .perf-mode .glass-sidebar, .perf-mode .glass-main { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: rgba(245,245,245,0.95) !important; }
        .perf-mode .glass-sidebar { background: rgba(28,49,37,0.95) !important; }
        .figma-card .icon-img { position: absolute; left: 0; right: 0; top: 5.9%; height: 51.8%; background-position: center; background-repeat: no-repeat; background-size: contain; z-index: 2; }
        .figma-card .card-title { position: absolute; left: 0; right: 0; top: 57.7%; font-family: 'Cal Sans', sans-serif; font-weight: 400; font-size: clamp(18px, 2.8vw, 40px); line-height: 1.2; letter-spacing: -0.5px; text-align: center; margin: 0; z-index: 2; }
        .title-beam { color: #FFFFFF; text-shadow: 0px 0px 34px rgba(0, 0, 0, 0.25); }
        .title-hub { color: #FFFFFF; text-shadow: 0px 4px 32px rgba(0, 0, 0, 0.25); }
        .figma-card .badge { position: absolute; left: 50%; transform: translateX(-50%); top: 80%; width: clamp(80px, 13vw, 180px); height: clamp(20px, 2.5vw, 32px); border-radius: 7px; z-index: 1; }
        .badge-beam { background: #4D6948; }
        .badge-hub { background: #696151; }
        .figma-card .subtitle { position: absolute; left: 0; right: 0; top: 80.7%; font-family: 'Cal Sans', sans-serif; font-weight: 400; font-size: clamp(10px, 1.2vw, 16px); line-height: 28px; letter-spacing: -0.5px; text-align: center; margin: 0; z-index: 2; display: flex; align-items: center; justify-content: center; }
        .subtitle-beam { color: #ACC7A4; }
        .subtitle-hub { color: #EAE2CA; }

        /* SCROLLBAR HIDING */
        ::-webkit-scrollbar { width: 0px; height: 0px; background: transparent; }
        * { scrollbar-width: none; }

        /* LIST ITEMS (Files) */
        .file-item { display: flex; align-items: center; justify-content: space-between; padding: 28px 24px; background: rgba(255, 255, 255, 0.6); border-radius: 20px; margin-bottom: 16px; font-family: 'Inter', sans-serif; color: #1C3125; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
        .file-icon { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; }
        .file-icon img { width: 100%; height: 100%; object-fit: contain; }

        /* SETTINGS */
        .setting-row { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: rgba(255,255,255,0.6); border-radius: 16px; margin-bottom: 16px; font-family: 'Inter', sans-serif; }
        .setting-info h4 { margin: 0 0 4px 0; color: #1C3125; font-size: 18px; }
        .setting-info p { margin: 0; font-size: 15px; color: #8c8266; }
        .setting-control input[type="text"] { padding: 12px 16px; border-radius: 8px; border: none; font-family: 'Inter', sans-serif; font-size: 16px; width: 250px; background: rgba(255,255,255,0.8); color: #1C3125; box-shadow: inset 0 2px 6px rgba(0,0,0,0.05); }

        /* INNER SCREENS (PIN & DRAG) */
        .pin-box { width: 80px; height: 96px; padding: 0; border-radius: 16px; border: 2px solid rgba(255,255,255,0.8); text-align: center; font-size: 56px; font-weight: 800; outline: none; background: rgba(255,255,255,0.4); color: #1C3125; box-shadow: inset 0 4px 12px rgba(0,0,0,0.05); font-family: 'Inter', sans-serif; transition: 0.2s; }
        .pin-box:focus { background: rgba(255,255,255,0.9); border-color: #1C3125; transform: translateY(-2px); }
        .beam-btn { width: auto; padding: 16px 32px; border-radius: 20px; border: none; font-weight: 700; font-size: 20px; cursor: pointer; transition: all 0.2s; font-family: 'Cal Sans'; background: #1C3125; color: white; display: flex; align-items: center; gap: 12px; }
        .beam-btn:hover { background: #4D6948; transform: translateY(-2px); }
        
        .drop-zone { background: rgba(255,255,255,0.4); border-radius: 24px; box-shadow: inset 0 4px 24px rgba(0,0,0,0.05); padding: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; border: 2px dashed rgba(28,49,37,0.2); }

        /* CHAT BUBBLES */
        .bubble-outgoing { background: #1C3125; color: white; border-radius: 24px 24px 4px 24px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); width: 100%; max-width: 600px; margin-left: auto; margin-bottom: 24px; }
        .bubble-incoming { background: rgba(255,255,255,0.7); backdrop-filter: blur(20px); border-radius: 24px 24px 24px 4px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.05); width: 100%; max-width: 600px; margin-right: auto; margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.5); }
        .bubble-file-row { display: grid; grid-template-columns: 48px 1fr auto; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.05); font-family: 'Inter', sans-serif; }
        .bubble-file-row:last-child { border-bottom: none; }
        .bubble-outgoing .bubble-file-row { border-bottom-color: rgba(255,255,255,0.1); }
      `}</style>

      {/* UPDATE REQUIRED BLOCKER */}
      {updateInfo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,49,37,0.95)', backdropFilter: 'blur(10px)', zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', padding: '40px', textAlign: 'center' }}>
          <AlertTriangle size={64} style={{ marginBottom: '24px', color: '#FCD34D' }} />
          <h1 style={{ fontFamily: 'Instrument Serif', fontSize: '48px', margin: '0 0 16px 0' }}>Update Required</h1>
          <p style={{ fontFamily: 'Inter', fontSize: '18px', maxWidth: '400px', lineHeight: 1.5, opacity: 0.9, marginBottom: '32px' }}>
            {updateInfo.update_message || "A critical update is required to continue using ShareDaa."}
          </p>
          <button onClick={() => invoke('open_browser_url', { url: 'ms-windows-store://' })} style={{ background: 'white', color: '#1C3125', padding: '16px 32px', borderRadius: '16px', border: 'none', fontWeight: 700, fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'Cal Sans', transition: '0.2s', boxShadow: '0 8px 24px rgba(255,255,255,0.2)' }}>
            <Download size={20} /> Update via Microsoft Store
          </button>
        </div>
      )}

      {/* SPLASH SCREEN OVERLAY */}
      <div style={{
        position: 'fixed', inset: 0, background: '#1E3528', zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        opacity: showSplash ? 1 : 0,
        pointerEvents: showSplash ? 'auto' : 'none',
        transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        <img src="/rocket.png" alt="Rocket" style={{ width: '180px', height: '180px', objectFit: 'contain', marginBottom: '32px', animation: 'floatAvatar 3s ease-in-out infinite' }} />
        <h1 style={{ fontFamily: '"Instrument Serif", serif', fontSize: '72px', color: '#F2EDE6', margin: 0, textShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>Share<em style={{ color: '#5A8A6A', fontStyle: 'italic' }}>Daa</em></h1>
      </div>

      {isVPNActive && (
        <div className="fade-in" style={{ position: 'absolute', bottom: '32px', left: '32px', background: '#DC2626', color: 'white', padding: '16px 24px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '12px', zIndex: 100, boxShadow: '0 8px 32px rgba(220, 38, 38, 0.4)', fontSize: '15px', fontWeight: 600, fontFamily: 'Inter' }}>
          <AlertTriangle size={20} /> VPN is currently active. P2P transfers may fail.
          <button onClick={() => setIsVPNActive(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', marginLeft: '12px', fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      <div className={`figma-canvas ${settings.performanceMode ? 'perf-mode' : ''}`}>
        {!settings.performanceMode && (
          <>
            <div className="bubbles-1"></div>
            <div className="bubbles"></div>
          </>
        )}

        <div className="dashboard-layout">

          {/* SIDEBAR (Liquid Glass Dark) */}
          <div className="glass-sidebar text-beam">
            <div className="sidebar-profile">
              <img src={avatarUrl} alt="Profile" onClick={() => setShowAvatarModal(true)} />
              <div>
                <h3>{settings.deviceName.split("'")[0]}</h3>
                <p className="text-beam-muted" style={{ margin: '4px 0 0 0' }}>Ready to share</p>
              </div>

              {showAvatarModal && (
                <div style={{ position: 'absolute', top: '90px', left: '0px', background: 'rgba(255,255,255,0.95)', padding: '16px', borderRadius: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.2)', zIndex: 50, display: 'flex', gap: '12px', border: '1px solid rgba(0,0,0,0.1)' }}>
                  {['/icon-avatar.png', '/icon-avatar2.png', '/icon-avatar3.png', '/icon-avatar4.png'].map(src => (
                    <img
                      key={src} src={src} alt="avatar option"
                      onClick={() => { setAvatarUrl(src); setShowAvatarModal(false); }}
                      style={{ width: '48px', height: '48px', borderRadius: '50%', cursor: 'pointer', border: avatarUrl === src ? '2px solid #1C3125' : '2px solid transparent', transition: '0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', animation: 'none' }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className={`nav-link ${currentView === 'main' ? 'active' : ''}`} onClick={() => handleNavClick('main')}>Home</div>
            <div className={`nav-link ${currentView === 'history' ? 'active' : ''}`} onClick={() => handleNavClick('history')}>History</div>
            <div className={`nav-link ${currentView === 'settings' ? 'active' : ''}`} onClick={() => handleNavClick('settings')}>Settings</div>
          </div>

          {/* MAIN CONTENT PANELS (Liquid Glass Light) */}
          <div className="glass-main text-hub">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h1 className="header-title" style={{ margin: 0 }}>
                  {currentView === 'main' && (() => {
                    const hour = new Date().getHours();
                    let greeting = 'Good evening';
                    if (hour < 12) greeting = 'Good morning';
                    else if (hour < 18) greeting = 'Good afternoon';
                    return `${greeting}, ${settings.deviceName.split("'")[0]}.`;
                  })()}
                  {currentView === 'beam' && 'Direct Beam'}
                  {currentView === 'hub' && 'Drop Hub'}
                  {currentView === 'history' && 'Transfer History'}
                  {currentView === 'settings' && 'Network Settings'}
                </h1>
              </div>

              {/* End Session Button */}
              {(beamState === 'connected' || hubState === 'connected') && (
                <button onClick={disconnectSession} style={{ background: '#DC2626', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, padding: '12px 24px', borderRadius: '99px', transition: '0.2s', fontFamily: 'Inter', boxShadow: '0 4px 12px rgba(220,38,38,0.3)' }}>
                  <X size={16} /> End Session
                </button>
              )}
            </div>

            {/* HOME VIEW */}
            {currentView === 'main' && (
              <>
                <div className="cards-row">
                  <div className="figma-card" onClick={() => setCurrentView('beam')}>
                    <div className="rect-shadow"></div>
                    <div className="rect-gradient card-bg-beam"></div>
                    <div className="icon-img" style={{ backgroundImage: "url('/icon-beam.png')", filter: 'drop-shadow(0px 4px 27px rgba(0,0,0,0.25))' }}></div>
                    <p className="card-title title-beam">Direct Beam</p>
                    <div className="badge badge-beam"></div>
                    <p className="subtitle subtitle-beam">Fast 1-to-1 transfer</p>
                  </div>

                  <div className="figma-card" onClick={() => setCurrentView('hub')}>
                    <div className="rect-shadow"></div>
                    <div className="rect-gradient card-bg-hub"></div>
                    <div className="icon-img" style={{ backgroundImage: "url('/icon-hub.png')", filter: 'drop-shadow(0px 4px 32px rgba(0,0,0,0.25))' }}></div>
                    <p className="card-title title-hub">Drop Hub</p>
                    <div className="badge badge-hub"></div>
                    <p className="subtitle subtitle-hub">Create or join workspace</p>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '28px', marginBottom: '24px' }}>Recent Transfers</h3>
                  {messages.length === 0 ? (
                    <div style={{ color: 'rgba(28,49,37,0.6)', fontFamily: 'Inter', fontSize: '16px' }}>No recent transfers. Send a file to see it here!</div>
                  ) : (
                    messages.slice(-3).reverse().map(msg => (
                      <div className="file-item" key={msg.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                          <div className="file-icon"><img src={getFileIconSrc(msg.name)} alt="icon" /></div>
                          <span style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '18px' }}>{msg.name}</span>
                        </div>
                        <span style={{ fontSize: '14px', color: 'rgba(28,49,37,0.7)' }}>
                          {msg.type === 'outgoing' ? 'Sent' : 'Received'} • {formatBytes(msg.size)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* BEAM VIEW */}
            {currentView === 'beam' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {beamState === 'setup' && (
                  <div style={{ display: 'flex', height: '100%', gap: '48px', alignItems: 'center' }}>
                    {/* Share Section with QR Code (Rebuilt from scratch) */}
                    <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                      {/* The bulletproof background layer */}
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.5)', borderRadius: '32px', zIndex: 0 }}></div>

                      {/* The content layer */}
                      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 40px', textAlign: 'center' }}>
                        <h3 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '16px' }}>Share your code</h3>
                        <p style={{ fontSize: '16px', color: 'rgba(28,49,37,0.7)', marginBottom: '32px', fontFamily: 'Inter' }}>Scan with the mobile app or enter PIN on desktop.</p>

                        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '24px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
                          <QRCode value={`http://${localIp}:5174/mobile.html?pin=${universalPin}&ip=${localIp}`} size={160} fgColor="#1C3125" qrStyle="dots" eyeRadius={8} />
                        </div>
                        <div style={{ fontSize: '48px', fontFamily: '"Cal Sans", sans-serif', letterSpacing: '4px', fontWeight: 600 }}>{universalPin}</div>
                      </div>
                    </div>

                    {/* Join Section with 4-box PIN (Rebuilt from scratch) */}
                    <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                      {/* The bulletproof background layer */}
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.3)', borderRadius: '32px', zIndex: 0 }}></div>

                      {/* The content layer */}
                      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 40px', textAlign: 'center' }}>
                        <h3 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '16px' }}>Join a device</h3>
                        <p style={{ fontSize: '16px', color: 'rgba(28,49,37,0.7)', marginBottom: '48px', fontFamily: 'Inter' }}>Enter the 4-digit PIN of the device you want to connect to.</p>

                        <div style={{ display: 'flex', gap: '16px', marginBottom: '48px' }}>
                          {[0, 1, 2, 3].map((index) => (
                            <input
                              key={index}
                              ref={pinRefs[index]}
                              type="text"
                              maxLength={1}
                              value={pinDigits[index]}
                              onChange={(e) => handlePinChange(index, e.target.value)}
                              onKeyDown={(e) => handlePinKeyDown(index, e)}
                              className="pin-box"
                            />
                          ))}
                        </div>

                        <button
                          className="beam-btn"
                          onClick={() => {
                            const enteredPin = pinDigits.join('');
                            if (enteredPin.length !== 4) showToast('Please enter a 4-digit PIN');
                            else if (enteredPin === universalPin) showToast('Cannot use your own PIN!');
                            else {
                              ws.send(JSON.stringify({ event: 'join-beam', payload: { pin: enteredPin } }));
                              // Timeout fallback if no device claims the PIN
                              setTimeout(() => {
                                if (!isConnectedRef.current) {
                                  showToast('Invalid PIN or device not found.');
                                }
                              }, 2000);
                            }
                          }}
                        >
                          <Link size={20} /> Secure Connect
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {beamState === 'connected' && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

                    {/* STAGED FILES QUEUE */}
                    {stagedFiles.length > 0 && (
                      <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '24px', padding: '24px', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', flexShrink: 0 }}>
                        <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', color: '#1C3125' }}>Ready to Send ({stagedFiles.length})</h3>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                          {stagedFiles.map((file, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.8)', padding: '12px 16px', borderRadius: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                                <img src={getFileIconSrc(file.name)} alt="icon" style={{ width: '24px', height: '24px' }} />
                                <span style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{file.name}</span>
                              </div>
                              <button onClick={() => setStagedFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626', border: 'none', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button onClick={() => setStagedFiles([])} style={{ flex: 1, padding: '12px', background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '12px', color: '#1C3125', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter' }}>Cancel All</button>
                          <button onClick={confirmAndSend} style={{ flex: 2, padding: '12px', background: 'var(--forest)', border: 'none', borderRadius: '12px', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontFamily: 'Inter' }}><UploadCloud size={18} /> Confirm & Send</button>
                        </div>
                      </div>
                    )}

                    {/* CHAT FEED */}
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {groupedSessionBatches.length === 0 && stagedFiles.length === 0 ? (
                        <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(28,49,37,0.5)' }}>
                          <UploadCloud size={64} style={{ marginBottom: '16px' }} />
                          <div style={{ fontSize: '24px', fontWeight: 600 }}>Connection Secure</div>
                          <div style={{ fontFamily: 'Inter' }}>Drag files below to begin transfer.</div>
                        </div>
                      ) : (
                        groupedSessionBatches.map(batch => (
                          <div key={batch.batchId} className={batch.type === 'outgoing' ? 'bubble-outgoing' : 'bubble-incoming'} style={{ padding: batch.files.length === 1 ? '16px' : '24px' }}>
                            {batch.files.length > 1 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(128,128,128,0.2)', paddingBottom: '16px' }}>
                                <h4 style={{ margin: 0, fontSize: '18px' }}>{batch.files.length} Files {batch.type === 'outgoing' ? 'Sent' : 'Received'}</h4>
                                {batch.type === 'incoming' && batch.status === 'completed' && (
                                  <button onClick={() => saveAllFiles(batch)} style={{ background: batch.files.every(f => f.saved) ? 'var(--forest)' : '#4D6948', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'Inter', fontWeight: 600, fontSize: '14px', transition: '0.2s' }}>
                                    {batch.files.every(f => f.saved) ? 'Saved All ✓' : 'Save All'}
                                  </button>
                                )}
                              </div>
                            )}

                            {batch.files.map((msg, idx) => (
                              <div key={msg.id} className="bubble-file-row" style={{ borderBottom: (idx === batch.files.length - 1) ? 'none' : '1px solid rgba(128,128,128,0.1)', padding: batch.files.length === 1 ? '0' : '12px 0' }}>
                                <div className="file-icon" style={{ width: '56px', height: '56px', background: 'rgba(255,255,255,0.4)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <img src={getFileIconSrc(msg.name)} alt="icon" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
                                </div>
                                <div style={{ overflow: 'hidden', paddingLeft: '8px', flex: 1 }}>
                                  <div style={{ fontWeight: 600, fontSize: '16px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{msg.name}</div>
                                  <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{formatBytes(msg.size)}</span>
                                    {msg.status !== 'completed' && msg.status !== 'cancelled' && (
                                      <span style={{ fontWeight: 600, color: batch.type === 'outgoing' ? 'white' : '#4D6948' }}>{msg.progress}%</span>
                                    )}
                                  </div>

                                  {msg.status === 'cancelled' ? (
                                    <div style={{ marginTop: '4px', fontSize: '14px', color: '#DC2626', fontWeight: 600 }}>Transfer Cancelled</div>
                                  ) : msg.status !== 'completed' && (
                                    <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.1)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                                      <div style={{ width: `${msg.progress}%`, height: '100%', background: batch.type === 'outgoing' ? 'white' : '#4D6948', transition: 'width 0.2s' }}></div>
                                    </div>
                                  )}
                                </div>

                                {msg.status === 'sending' || msg.status === 'receiving' ? (
                                  <button onClick={() => cancelTransfer(msg.id)} style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626', border: 'none', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: '0.2s' }}>
                                    <X size={18} />
                                  </button>
                                ) : batch.type === 'incoming' && msg.status === 'completed' && (
                                  <button onClick={() => saveFile(msg)} disabled={msg.saved} style={{ background: msg.saved ? 'var(--forest)' : 'white', border: msg.saved ? '1px solid var(--forest)' : 'none', color: msg.saved ? 'white' : '#1C3125', padding: '10px 16px', borderRadius: '12px', cursor: msg.saved ? 'default' : 'pointer', fontFamily: 'Inter', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transition: 'all 0.2s' }}>
                                    {msg.saved ? 'Saved ✓' : <><Download size={16} /> Save</>}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>

                    {/* DROP ZONE (Footer) */}
                    <div className="drop-zone" style={{ marginTop: '24px', height: '140px', background: isDragging ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)', transition: '0.2s', padding: '24px', flexDirection: 'row', gap: '24px' }}>
                      <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: '24px', fontWeight: 600 }}>Drop files here</div>
                        <div style={{ fontFamily: 'Inter', color: 'rgba(28,49,37,0.7)', marginTop: '4px', fontSize: '15px' }}>Drag multiple files to send them as a batch.</div>
                      </div>
                      <button onClick={() => fileInputRef.current.click()} className="beam-btn" style={{ padding: '12px 24px', fontSize: '16px' }}>
                        <Plus size={18} /> Browse Files
                      </button>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* HUB VIEW */}
            {currentView === 'hub' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', height: '100%', gap: '48px', alignItems: 'center' }}>
                  {/* Create Hub */}
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.5)', borderRadius: '24px', padding: '64px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                    <div style={{ background: '#FFFFFF', padding: '24px', borderRadius: '50%', boxShadow: '0 8px 24px rgba(0,0,0,0.05)', marginBottom: '32px' }}>
                      <Users size={64} color="#1C3125" />
                    </div>
                    <h3 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '16px' }}>Create a Workspace</h3>
                    <p style={{ fontSize: '16px', color: 'rgba(28,49,37,0.7)', marginBottom: '32px', fontFamily: 'Inter', maxWidth: '300px' }}>Start a collaborative session for multiple devices.</p>

                    <button className="beam-btn" onClick={() => showToast('Hub functionality coming soon!')}>
                      <Plus size={20} /> New Hub
                    </button>
                  </div>

                  {/* Join Hub */}
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.3)', borderRadius: '24px', padding: '64px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                    <div style={{ background: '#FFFFFF', padding: '24px', borderRadius: '50%', boxShadow: '0 8px 24px rgba(0,0,0,0.05)', marginBottom: '32px' }}>
                      <Share2 size={64} color="#1C3125" />
                    </div>
                    <h3 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '16px' }}>Join a Workspace</h3>
                    <p style={{ fontSize: '16px', color: 'rgba(28,49,37,0.7)', marginBottom: '32px', fontFamily: 'Inter', maxWidth: '300px' }}>Enter a Hub Code to join an existing session.</p>

                    <button className="beam-btn" style={{ background: 'transparent', color: '#1C3125', border: '2px solid #1C3125' }} onClick={() => showToast('Hub functionality coming soon!')}>
                      Join Hub
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* HISTORY VIEW */}
            {currentView === 'history' && (
              <div style={{ flex: 1 }}>
                {messages.length === 0 ? (
                  <div style={{ color: 'rgba(28,49,37,0.6)', fontFamily: 'Inter', fontSize: '16px' }}>Your history is clean.</div>
                ) : (
                  messages.map((msg, i) => (
                    <div className="file-item" key={i}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div className="file-icon"><img src={getFileIconSrc(msg.name)} alt="icon" /></div>
                        <span style={{ fontSize: '18px' }}>{msg.name}</span>
                      </div>
                      <span style={{ fontSize: '14px', color: 'rgba(28,49,37,0.7)' }}>
                        {msg.type === 'outgoing' ? 'Sent' : 'Received'} • {formatBytes(msg.size)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* SETTINGS VIEW */}
            {currentView === 'settings' && (
              <div className="fade-in" style={{ padding: '40px' }}>
                <h2 style={{ fontSize: '28px', color: '#1E3528', marginBottom: '24px', fontFamily: 'Instrument Serif' }}>Settings</h2>

                <div style={{ background: 'rgba(255,255,255,0.4)', padding: '24px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.6)', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', color: '#3D6B52', marginBottom: '16px', fontWeight: 600 }}>Device Profile</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '14px', color: '#1E3528', fontWeight: 500 }}>Device Name</label>
                    <input
                      type="text"
                      value={settings.deviceName}
                      onChange={(e) => setSettings({ ...settings, deviceName: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                          showToast("Name saved!");
                        }
                      }}
                      style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(61,107,82,0.2)', background: 'white', color: '#1E3528', fontWeight: 600, outline: 'none' }}
                    />
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.4)', padding: '24px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.6)', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', color: '#3D6B52', marginBottom: '16px', fontWeight: 600 }}>Developer</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <img src="/icon-avatar.png" alt="Varun Kulkarni" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} />
                      <div>
                        <h4 style={{ margin: 0, fontSize: '18px', color: '#1E3528' }}>Varun Kulkarni</h4>
                        <p style={{ margin: 0, fontSize: '14px', color: '#5A8A6A' }}>Creator & Lead Developer</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                      <button onClick={() => invoke('open_browser_url', { url: 'mailto:varunkulkarni214@gmail.com' }).catch(() => { })} style={{ background: '#3D6B52', color: 'white', padding: '10px 16px', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Contact Support
                      </button>
                      <button onClick={() => invoke('open_browser_url', { url: 'https://sharedaa.varunkulkarni.dpdns.org/' }).catch(() => { })} style={{ background: 'white', color: '#3D6B52', padding: '10px 16px', borderRadius: '8px', border: '1px solid #3D6B52', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Visit Portfolio <Link size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.4)', padding: '24px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.6)', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', color: '#3D6B52', marginBottom: '16px', fontWeight: 600 }}>Legal & About</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p style={{ fontSize: '14px', color: '#1E3528', lineHeight: 1.5 }}>
                      ShareDaa is a true zero-cloud P2P application. We do not collect telemetry, and your files never leave your local network.
                    </p>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <button onClick={() => invoke('open_browser_url', { url: 'https://sharedaa.varunkulkarni.dpdns.org/privacy.html' }).catch(err => showToast("Could not open browser."))} style={{ background: '#3D6B52', color: 'white', padding: '10px 16px', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Read Privacy Policy <Link size={14} />
                      </button>
                      <button onClick={() => invoke('open_browser_url', { url: 'https://sharedaa.varunkulkarni.dpdns.org/' }).catch(err => showToast("Could not open browser."))} style={{ background: 'white', color: '#3D6B52', padding: '10px 16px', borderRadius: '8px', border: '1px solid #3D6B52', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Visit Website <Link size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-info">
                    <h4>Discoverability</h4>
                    <p>Allow nearby devices to find your node</p>
                  </div>
                  <div className="setting-control">
                    <div style={{
                      background: settings.discoverable ? '#4D6948' : 'rgba(0,0,0,0.1)',
                      width: '50px', height: '28px', borderRadius: '14px', position: 'relative', cursor: 'pointer', transition: '0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                    }} onClick={() => setSettings({ ...settings, discoverable: !settings.discoverable })}>
                      <div style={{
                        position: 'absolute', top: '2px', left: settings.discoverable ? '24px' : '2px',
                        width: '24px', height: '24px', background: 'white', borderRadius: '50%', transition: '0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }}></div>
                    </div>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <h4>Auto-Accept Transfers</h4>
                    <p>Automatically download incoming files from paired devices</p>
                  </div>
                  <div className="setting-control">
                    <div style={{
                      background: settings.autoAccept ? '#4D6948' : 'rgba(0,0,0,0.1)',
                      width: '50px', height: '28px', borderRadius: '14px', position: 'relative', cursor: 'pointer', transition: '0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                    }} onClick={() => setSettings({ ...settings, autoAccept: !settings.autoAccept })}>
                      <div style={{
                        position: 'absolute', top: '2px', left: settings.autoAccept ? '24px' : '2px',
                        width: '24px', height: '24px', background: 'white', borderRadius: '50%', transition: '0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>



      {toastMessage && (
        <div className="fade-in" style={{ position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)', background: '#1C3125', color: 'white', padding: '16px 24px', borderRadius: '12px', fontWeight: 600, fontSize: '14px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 9999, fontFamily: 'Inter' }}>
          {toastMessage}
        </div>
      )}

      {/* Privacy Policy Popup (First Launch) */}
      {showPolicyPopup && (
        <div className="fade-in" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'white', padding: '40px', borderRadius: '32px', width: '400px', textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontFamily: 'Instrument Serif', fontSize: '40px', color: '#1E3528', marginBottom: '16px' }}>Welcome to ShareDaa</h2>
            <p style={{ color: '#3D6B52', fontSize: '16px', lineHeight: 1.5, marginBottom: '32px' }}>
              We believe in absolute privacy. Your files never leave your local network, and we collect zero data. Period.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => {
                  setShowPolicyPopup(false);
                  localStorage.setItem('policy_seen', 'true');
                  setCurrentView('settings');
                }}
                style={{ background: '#1E3528', color: 'white', padding: '14px', borderRadius: '12px', border: 'none', fontWeight: 700, fontSize: '16px', cursor: 'pointer' }}>
                View Privacy Policy
              </button>
              <button
                onClick={() => {
                  setShowPolicyPopup(false);
                  localStorage.setItem('policy_seen', 'true');
                }}
                style={{ background: 'transparent', color: '#8A7E6F', padding: '14px', borderRadius: '12px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
