import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { RefreshCw, Wifi, WifiOff, QrCode, Send, MessageCircle, LogOut } from 'lucide-react';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<string>('disconnected');
  const [qr, setQr] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; text: string } | null>(null);
  const [lastReceived, setLastReceived] = useState<{ phone: string; text: string; timestamp: string } | null>(null);
  const [loadingLast, setLoadingLast] = useState(false);

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
    setError(null);
    try {
      await api.post('/whatsapp/restart');
    } catch (err: any) {
      alert(err.message);
      setStatus('disconnected');
    } finally {
      setRestarting(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('זה ינתק את החיבור לוואטסאפ וימחק את ה-session. תצטרך לסרוק QR מחדש. להמשיך?')) return;
    setError(null);
    try {
      await api.post('/whatsapp/logout');
      setStatus('disconnected');
      setQr(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSendTest = async () => {
    if (!testPhone || !testMessage) return;
    setSending(true);
    setSendResult(null);
    try {
      await api.post('/whatsapp/send-test', { phone: testPhone, message: testMessage });
      setSendResult({ success: true, text: 'ההודעה נשלחה בהצלחה!' });
      setTestMessage('');
    } catch (err: any) {
      setSendResult({ success: false, text: err.message || 'שגיאה בשליחה' });
    } finally {
      setSending(false);
    }
  };

  const fetchLastReceived = async () => {
    setLoadingLast(true);
    try {
      const data = await api.get<{ phone: string; text: string; timestamp: string } | null>('/whatsapp/last-received');
      setLastReceived(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLast(false);
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
          <div className="flex gap-2">
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
              הפעל מחדש
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50"
            >
              <LogOut size={14} />
              נתק
            </button>
          </div>
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

        {status === 'disconnected' && error && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-800 text-sm">
            <p className="font-medium mb-1">לא מצליח להתחבר?</p>
            <p>לחץ על "נתק" כדי למחוק את ה-session הישן, ואז לחץ "הפעל מחדש" לקבל QR חדש.</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      {status === 'connected' && (
        <div className="bg-white rounded-lg shadow-sm border border-border p-6 max-w-lg mt-6">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Send size={18} />
            שליחת הודעת בדיקה
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">מספר טלפון</label>
              <input
                type="tel"
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="050-1234567"
                className="w-full px-3 py-2 border border-border rounded-md text-sm"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">הודעה</label>
              <textarea
                value={testMessage}
                onChange={e => setTestMessage(e.target.value)}
                placeholder="הקלד הודעת בדיקה..."
                rows={3}
                className="w-full px-3 py-2 border border-border rounded-md text-sm resize-none"
              />
            </div>
            <button
              onClick={handleSendTest}
              disabled={sending || !testPhone || !testMessage}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50"
            >
              <Send size={14} className={sending ? 'animate-pulse' : ''} />
              {sending ? 'שולח...' : 'שלח'}
            </button>

            {sendResult && (
              <div className={`p-3 rounded-md text-sm ${sendResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {sendResult.text}
              </div>
            )}
          </div>

          <hr className="my-5 border-border" />

          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <MessageCircle size={18} />
            הודעה אחרונה שהתקבלה
          </h3>

          <button
            onClick={fetchLastReceived}
            disabled={loadingLast}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50 mb-3"
          >
            <RefreshCw size={14} className={loadingLast ? 'animate-spin' : ''} />
            רענן
          </button>

          {lastReceived ? (
            <div className="p-3 bg-gray-50 border border-border rounded-md text-sm space-y-1">
              <p><span className="font-medium">מאת:</span> <span dir="ltr">{lastReceived.phone}</span></p>
              <p><span className="font-medium">הודעה:</span> {lastReceived.text}</p>
              <p className="text-muted-foreground text-xs">
                {new Date(lastReceived.timestamp).toLocaleString('he-IL')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">אין הודעות עדיין</p>
          )}
        </div>
      )}
    </div>
  );
}
