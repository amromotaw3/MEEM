import React, { useState, useEffect } from 'react';
// Note: You need to install @capacitor-community/zeroconf
// import { Zeroconf } from '@capacitor-community/zeroconf';

/**
 * Hook to discover MediaVault PC servers on the local network
 */
export const usePCDiscovery = () => {
    const [discoveredPC, setDiscoveredPC] = useState(null);
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        // Only run on mobile/Capacitor
        if (typeof window === 'undefined' || !window.Capacitor) return;

        const startDiscovery = async () => {
            setIsScanning(true);
            try {
                // 1. Listen for the MediaVault service
                // await Zeroconf.watch('_mediavault._tcp', 'local.', (result) => {
                //     const { action, service } = result;
                //     if (action === 'resolved') {
                //         console.log('Found MediaVault PC:', service);
                //         const ip = service.ipv4Addresses[0];
                //         const port = service.port;
                //         setDiscoveredPC({ ip, port, name: service.name });
                //     }
                // });
                
                // MOCK for development
                setTimeout(() => {
                    setDiscoveredPC({ ip: '192.168.1.5', port: 3000, name: 'Amro-Laptop' });
                    setIsScanning(false);
                }, 2000);

            } catch (err) {
                console.error('Discovery failed:', err);
                setIsScanning(false);
            }
        };

        startDiscovery();

        return () => {
            // Zeroconf.unwatch('_mediavault._tcp', 'local.');
            // Zeroconf.close();
        };
    }, []);

    return { discoveredPC, isScanning };
};

/**
 * Component to display and connect to a local PC
 */
export const LocalSyncView = () => {
    const { discoveredPC, isScanning } = usePCDiscovery();
    const [library, setLibrary] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const connectToPC = async () => {
        if (!discoveredPC) return;
        setIsLoading(true);
        try {
            const response = await fetch(`http://${discoveredPC.ip}:${discoveredPC.port}/api/library`);
            const data = await response.json();
            setLibrary(data.movies || []); // Assuming the PC sends { movies: [...] }
        } catch (err) {
            alert('Failed to connect to PC: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="local-sync-container" style={{ padding: '20px', color: '#fff' }}>
            <h2><i className="fas fa-network-wired"></i> Local Network Sync</h2>
            
            {!discoveredPC ? (
                <div className="discovery-status">
                    {isScanning ? (
                        <p><i className="fas fa-spinner fa-spin"></i> Searching for MEEM PCs on your Wi-Fi...</p>
                    ) : (
                        <p>No PC found. Ensure MEEM is running on your PC and both devices are on the same Wi-Fi.</p>
                    )}
                </div>
            ) : (
                <div className="pc-card" style={{ 
                    background: 'var(--bg-surface-2)', 
                    padding: '20px', 
                    borderLeft: '4px solid var(--accent)',
                    borderRadius: '12px' 
                }}>
                    <h3>Found: {discoveredPC.name}</h3>
                    <p>IP: {discoveredPC.ip}:{discoveredPC.port}</p>
                    <button 
                        className="btn-primary" 
                        onClick={connectToPC}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Connecting...' : 'Browse PC Library'}
                    </button>
                </div>
            )}

            <div className="remote-library-grid" style={{ marginTop: '30px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' }}>
                {library.map(movie => (
                    <div key={movie.id} className="media-card" onClick={() => playRemoteMovie(movie, discoveredPC)}>
                        <img src={movie.poster} alt={movie.title} style={{ width: '100%', borderRadius: '8px' }} />
                        <div className="title">{movie.title}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const playRemoteMovie = (movie, pc) => {
    const streamUrl = `http://${pc.ip}:${pc.port}/stream?path=${encodeURIComponent(movie.path)}`;
    // Pass to your existing playVideo function
    console.log('Playing remote stream:', streamUrl);
    // playVideo({ ...movie, path: streamUrl, isStream: true });
};
