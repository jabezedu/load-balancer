'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface Server {
  id: number;
  balancer_id: number;
  name: string;
  weight: number;
  is_healthy: boolean;
  request_count: number;
  share_percent: number;
}

interface RequestLog {
  id: number;
  balancer_id: number;
  server_id: number;
  server_name: string;
  client_ip: string;
  duration_ms: number;
  created_at: string;
}

interface Balancer {
  id: number;
  name: string;
  algorithm: 'round_robin' | 'weighted_round_robin' | 'least_connections' | 'ip_hash';
  total_requests: number;
  servers: Server[];
  recent_logs: RequestLog[];
}

export default function LoadBalancerDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [balancers, setBalancers] = useState<Balancer[]>([]);
  const [selectedBalancer, setSelectedBalancer] = useState<Balancer | null>(null);

  // Simulation controls
  const [requestCount, setRequestCount] = useState(25);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState('');
  const [simSuccess, setSimSuccess] = useState('');

  // Create Balancer Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newBalancerName, setNewBalancerName] = useState('');
  const [newAlgorithm, setNewAlgorithm] = useState<'round_robin' | 'weighted_round_robin' | 'least_connections' | 'ip_hash'>('round_robin');
  const [newServers, setNewServers] = useState([
    { name: 'srv-app-alpha', weight: 3, is_healthy: true },
    { name: 'srv-app-beta', weight: 2, is_healthy: true },
    { name: 'srv-app-gamma', weight: 1, is_healthy: true },
  ]);
  const [modalError, setModalError] = useState('');

  const fetchBalancers = async () => {
    try {
      const res = await apiFetch('/api/balancers');
      if (res.ok) {
        const data: Balancer[] = await res.json();
        setBalancers(data);
        if (data.length > 0) {
          if (!selectedBalancer) {
            setSelectedBalancer(data[0]);
          } else {
            const current = data.find((b) => b.id === selectedBalancer.id);
            if (current) setSelectedBalancer(current);
            else setSelectedBalancer(data[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch balancers', err);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    fetchBalancers();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const handleAlgorithmChange = async (algorithm: any) => {
    if (!selectedBalancer) return;
    try {
      const res = await apiFetch(`/api/balancers/${selectedBalancer.id}/algorithm`, {
        method: 'PATCH',
        body: JSON.stringify({ algorithm }),
      });
      if (res.ok) {
        await fetchBalancers();
      }
    } catch (err) {
      console.error('Failed to change algorithm', err);
    }
  };

  const handleToggleHealth = async (server: Server) => {
    if (!selectedBalancer) return;
    try {
      const res = await apiFetch(`/api/balancers/${selectedBalancer.id}/servers/${server.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_healthy: !server.is_healthy }),
      });
      if (res.ok) {
        await fetchBalancers();
      }
    } catch (err) {
      console.error('Failed to toggle health', err);
    }
  };

  const handleUpdateWeight = async (server: Server, newWeight: number) => {
    if (!selectedBalancer) return;
    try {
      const res = await apiFetch(`/api/balancers/${selectedBalancer.id}/servers/${server.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ weight: newWeight }),
      });
      if (res.ok) {
        await fetchBalancers();
      }
    } catch (err) {
      console.error('Failed to update weight', err);
    }
  };

  const handleSendRequests = async () => {
    if (!selectedBalancer) return;
    setSimError('');
    setSimSuccess('');
    setIsSimulating(true);

    try {
      const res = await apiFetch(`/api/balancers/${selectedBalancer.id}/simulate`, {
        method: 'POST',
        body: JSON.stringify({ count: requestCount, algorithm: selectedBalancer.algorithm }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Simulation failed');
      }
      setSimSuccess(`Processed ${requestCount} requests across backends!`);
      await fetchBalancers();
    } catch (err: any) {
      setSimError(err.message);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleResetStats = async () => {
    if (!selectedBalancer) return;
    if (!confirm('Are you sure you want to reset all request stats and logs for this balancer?')) return;
    try {
      const res = await apiFetch(`/api/balancers/${selectedBalancer.id}/reset`, {
        method: 'POST',
      });
      if (res.ok) {
        setSimSuccess('Stats reset successfully.');
        await fetchBalancers();
      }
    } catch (err) {
      console.error('Failed to reset stats', err);
    }
  };

  // Add/remove server row in create balancer modal (3-6 servers constraint)
  const addServerRow = () => {
    if (newServers.length < 6) {
      setNewServers([
        ...newServers,
        { name: `srv-backend-0${newServers.length + 1}`, weight: 1, is_healthy: true },
      ]);
    }
  };

  const removeServerRow = (index: number) => {
    if (newServers.length > 3) {
      setNewServers(newServers.filter((_, i) => i !== index));
    }
  };

  const handleCreateBalancer = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (newServers.length < 3 || newServers.length > 6) {
      setModalError('Please define between 3 and 6 backend servers.');
      return;
    }

    try {
      const res = await apiFetch('/api/balancers', {
        method: 'POST',
        body: JSON.stringify({
          name: newBalancerName,
          algorithm: newAlgorithm,
          servers: newServers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create balancer');
      }
      setIsModalOpen(false);
      setNewBalancerName('');
      await fetchBalancers();
      setSelectedBalancer(data);
    } catch (err: any) {
      setModalError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-600 text-white font-bold shadow-sm">
              LB
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-white leading-none">Cloud Load Balancer</h1>
              <span className="text-xs text-slate-500 dark:text-slate-400">Traffic Distribution Simulator</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline-block">
              {user?.email}
            </span>
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-purple-700 transition"
            >
              + New Balancer
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-6">
        {/* Balancer Selector / Header */}
        {balancers.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase mr-2">Cluster:</span>
            {balancers.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBalancer(b)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selectedBalancer?.id === b.id
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {selectedBalancer ? (
          <>
            {/* Control & Algorithm Panel */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-700">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{selectedBalancer.name}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Total Inbound Requests Handled: <span className="font-semibold text-purple-600 dark:text-purple-400">{selectedBalancer.total_requests}</span>
                  </p>
                </div>

                {/* Algorithm Selector */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Algorithm:</label>
                  <select
                    value={selectedBalancer.algorithm}
                    onChange={(e) => handleAlgorithmChange(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="round_robin">Round Robin</option>
                    <option value="weighted_round_robin">Weighted Round Robin</option>
                    <option value="least_connections">Least Connections</option>
                    <option value="ip_hash">IP Hash</option>
                  </select>
                </div>
              </div>

              {/* Simulation Action Bar */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Requests to dispatch:</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={requestCount}
                    onChange={(e) => setRequestCount(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-center text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                  <button
                    onClick={handleSendRequests}
                    disabled={isSimulating}
                    className="rounded-lg bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSimulating ? (
                      <>
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Simulating...
                      </>
                    ) : (
                      `Send ${requestCount} Requests`
                    )}
                  </button>
                </div>

                <button
                  onClick={handleResetStats}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400 transition"
                >
                  Reset Stats
                </button>
              </div>

              {/* Feedback alerts */}
              {simError && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300">
                  {simError}
                </div>
              )}
              {simSuccess && (
                <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300">
                  {simSuccess}
                </div>
              )}
            </div>

            {/* Backend Servers & Div-based Progress Bars */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                Backend Servers Pool ({selectedBalancer.servers.length})
              </h3>
              <div className="space-y-4">
                {selectedBalancer.servers.map((server) => {
                  return (
                    <div
                      key={server.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-700/60 dark:bg-slate-900/40 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-sm text-slate-900 dark:text-white">{server.name}</span>
                          <button
                            onClick={() => handleToggleHealth(server)}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition ${
                              server.is_healthy
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-950/50 dark:text-rose-300'
                            }`}
                          >
                            {server.is_healthy ? '● Healthy' : '○ Unhealthy (Skipped)'}
                          </button>
                        </div>

                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Weight:</span>
                            <select
                              value={server.weight}
                              onChange={(e) => handleUpdateWeight(server, parseInt(e.target.value, 10))}
                              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((w) => (
                                <option key={w} value={w}>{w}</option>
                              ))}
                            </select>
                          </div>

                          <div className="text-slate-500">
                            Requests: <span className="font-bold text-slate-800 dark:text-slate-200">{server.request_count}</span>
                          </div>

                          <div className="w-14 text-right font-mono font-bold text-purple-600 dark:text-purple-400">
                            {server.share_percent}%
                          </div>
                        </div>
                      </div>

                      {/* Div-based Progress Bar */}
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full transition-all duration-500 ${
                            server.is_healthy ? 'bg-purple-600' : 'bg-slate-400 opacity-40'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, server.share_percent))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Request Log of last 50 requests */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Simulation Traffic Log (Last {selectedBalancer.recent_logs.length})
                </h3>
                <span className="text-xs text-slate-400">Simulated 50ms interval</span>
              </div>

              {selectedBalancer.recent_logs.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-400">
                  No requests sent yet. Click &quot;Send Requests&quot; to test balancing algorithm.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                    <thead className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider text-slate-400 sticky top-0 bg-white dark:bg-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Client IP</th>
                        <th className="py-2.5 px-3">Dispatched Server</th>
                        <th className="py-2.5 px-3">Duration (Latency)</th>
                        <th className="py-2.5 px-3 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {selectedBalancer.recent_logs.map((log, idx) => (
                        <tr key={log.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-2.5 px-3 text-slate-400">{selectedBalancer.recent_logs.length - idx}</td>
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-800 dark:text-slate-200">{log.client_ip}</td>
                          <td className="py-2.5 px-3 font-semibold text-purple-600 dark:text-purple-400">{log.server_name}</td>
                          <td className="py-2.5 px-3 font-mono">{log.duration_ms} ms</td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-64 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <p className="text-sm font-medium">No Load Balancer available. Click &quot;+ New Balancer&quot; to configure one.</p>
          </div>
        )}
      </main>

      {/* Modal to Create Balancer */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create Load Balancer</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400 border border-red-200">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateBalancer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Balancer Name</label>
                <input
                  type="text"
                  placeholder="api-cluster-us-east"
                  value={newBalancerName}
                  onChange={(e) => setNewBalancerName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Default Algorithm</label>
                <select
                  value={newAlgorithm}
                  onChange={(e) => setNewAlgorithm(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value="round_robin">Round Robin</option>
                  <option value="weighted_round_robin">Weighted Round Robin</option>
                  <option value="least_connections">Least Connections</option>
                  <option value="ip_hash">IP Hash</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Backend Servers (3 to 6)</label>
                  {newServers.length < 6 && (
                    <button
                      type="button"
                      onClick={addServerRow}
                      className="text-xs text-purple-600 dark:text-purple-400 font-medium hover:underline"
                    >
                      + Add Server
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {newServers.map((srv, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={srv.name}
                        onChange={(e) => {
                          const updated = [...newServers];
                          updated[idx].name = e.target.value;
                          setNewServers(updated);
                        }}
                        placeholder="server-name"
                        required
                        className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">W:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={srv.weight}
                          onChange={(e) => {
                            const updated = [...newServers];
                            updated[idx].weight = parseInt(e.target.value, 10) || 1;
                            setNewServers(updated);
                          }}
                          className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs text-center dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                      </div>
                      <label className="flex items-center gap-1 text-[11px] text-slate-500">
                        <input
                          type="checkbox"
                          checked={srv.is_healthy}
                          onChange={(e) => {
                            const updated = [...newServers];
                            updated[idx].is_healthy = e.target.checked;
                            setNewServers(updated);
                          }}
                        />
                        OK
                      </label>
                      {newServers.length > 3 && (
                        <button
                          type="button"
                          onClick={() => removeServerRow(idx)}
                          className="text-red-500 text-xs px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700"
                >
                  Create Balancer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
