import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { RefreshCw, Wifi, WifiOff, QrCode } from 'lucide-react';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<string>('disconnected');
  const [qr, setQr] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
    const socket = getSocket();
    socket.on('whatsapp:status', (data: { status: string }) => {
      setStatus(data.status);
      setError(null);
      if (data.status === 'connected' || data.status === 'disconnected') {
        setQr(null);
      }
    });
    socket.on('whatsapp:qr', (data: { qr: string }) => setQr(data.qr));
    socket.on('whatsapp:error', (data: { error: string }) => setError(data.error));
    return () => {
      socket.off('whatsapp:status');
      socket.off('whatsapp:qr');
      socket.off('whatsapp:error');
    };
  }, []);

  const loadStatus = async () => {
    try {
      const data = await api.get<{ status: string }>('/whatsapp/status');
      setStatus(data.status);
      const qrData = await api.get<{ qr: string | null }>('/whatsapp/qr');
      if (qrData.qr) setQr(qrData.qr);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setStatus('connecting');
    setQr(null);
    try {
      await api.post('/whatsapp/restart');
    } catch (err: any) {
      alert(err.message);
      setStatus('disconnected');
    } finally {
      setRestarting(false);
    }
  };

  const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    connected: { label: 'מחובר', color: 'text-green-600 bg-green-50', icon: Wifi },
    connecting: { label: 'מתחבר...', color: 'text-yellow-600 bg-yellow-50', icon: RefreshCw },
    qr: { label: 'ממתין לסריקת QR', color: 'text-blue-600 bg-blue-50', icon: QrCode },
    disconnected: { label: 'מנותק', color: 'text-red-600 bg-red-50', icon: WifiOff },
  };

  const config = statusConfig[status] || statusConfig.disconnected;
  const StatusIcon = config.icon;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">חיבור וואטסאפ</h2>

      <div className="bg-white rounded-lg shadow-sm border border-border p-6 max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.color}`}>
              <StatusIcon size={20} />
            </div>
            <div>
              <p className="font-semibold">סטטוס חיבור</p>
              <p className={`text-sm ${config.color.split(' ')[0]}`}>{config.label}</p>
            </div>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
            הפעל מחדש
          </button>
        </div>

        {qr && status === 'qr' && (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-3">סרוק את הקוד באפליקציית וואטסאפ</p>
            <img src={qr} alt="QR Code" className="mx-auto max-w-[300px] border border-border rounded-lg" />
          </div>
        )}

        {status === 'connected' && (
          <div className="text-center text-green-600">
            <p>הבוט מחובר ופעיל</p>
          </div>
        )}

        {status === 'connecting' && !qr && (
          <div className="text-center text-yellow-600">
            <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
            <p>מתחבר לוואטסאפ...</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
