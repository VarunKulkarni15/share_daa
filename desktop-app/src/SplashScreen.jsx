import React, { useEffect, useState } from 'react';
import './index.css';

export default function SplashScreen({ onComplete }) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    // Start animation quickly
    const startTimer = setTimeout(() => {
      setIsAnimating(true);
    }, 100);

    // End splash screen and transition to main app
    const endTimer = setTimeout(() => {
      setIsFinished(true);
      setTimeout(() => {
        onComplete();
      }, 800); // Wait for the 0.8s fade out transition
    }, 3100); // 3.1 seconds for the animation to finish

    return () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
    };
  }, [onComplete]);

  return (
    <div id="splash" style={{ opacity: isFinished ? 0 : 1, pointerEvents: isFinished ? 'none' : 'auto' }}>
      <div className="splash-center" style={{ position: 'absolute', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 className="splash-logo">
          Share<em>Daa</em>
        </h1>
      </div>
      <div className={`rocket-rig ${isAnimating ? 'animate' : ''}`}>
        <div className="physics-wrapper">
          <img src="/rocket.png" className="splash-rocket-img" alt="Rocket" />
        </div>
      </div>
      
      <style>{`
        #splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: var(--forest);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          transition: opacity 0.8s ease, clip-path 0.8s cubic-bezier(0.7, 0, 0.1, 1);
        }

        .splash-logo {
          font-family: 'Instrument Serif', serif;
          font-size: 110px;
          color: var(--cream);
          letter-spacing: -2px;
          transition: opacity 0.5s ease;
        }

        .splash-logo em {
          color: var(--sage);
          font-style: italic;
        }

        .rocket-rig {
          position: absolute;
          top: 50%;
          left: 0;
          transform: translate(-100vw, -50%);
          z-index: 20;
        }

        .physics-wrapper {
          filter: drop-shadow(-15px 15px 20px rgba(0, 0, 0, 0.4));
        }

        .splash-rocket-img {
          width: 220px;
          height: 220px;
          object-fit: contain;
          transform: rotate(45deg);
        }

        @keyframes master-flight {
          0% { transform: translate(-100vw, -50%); animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1); }
          45% { transform: translate(calc(50vw - 60px), -50%); animation-timing-function: cubic-bezier(0.4, 0, 0.3, 1); }
          65% { transform: translate(calc(50vw - 140px), -50%); animation-timing-function: cubic-bezier(0.7, 0, 0.2, 1); }
          100% { transform: translate(150vw, -50%); }
        }

        @keyframes master-pitch {
          0% { transform: rotate(-12deg) scale(0.95); }
          45% { transform: rotate(0deg) scale(1); }
          65% { transform: rotate(6deg) scale(0.97); }
          80% { transform: rotate(-2deg) scaleX(1.1) scaleY(0.95) translateX(10px); }
          100% { transform: rotate(-2deg) scaleX(1.25) scaleY(0.9) translateX(30px); }
        }

        .rocket-rig.animate {
          animation: master-flight 3s forwards;
          will-change: transform;
        }

        .rocket-rig.animate .physics-wrapper {
          animation: master-pitch 3s forwards;
          will-change: transform;
        }
      `}</style>
    </div>
  );
}
