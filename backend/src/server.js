const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const { seedAdminUser, login, authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4003;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3003';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', login);

app.use('/api', authMiddleware);

// Get or list balancers
app.get('/api/balancers', async (req, res) => {
  try {
    const balancersResult = await db.query(
      'SELECT * FROM balancers ORDER BY created_at ASC'
    );

    const balancers = await Promise.all(
      balancersResult.rows.map(async (b) => {
        const serversRes = await db.query(
          'SELECT * FROM servers WHERE balancer_id = $1 ORDER BY id ASC',
          [b.id]
        );
        const logsRes = await db.query(
          `SELECT id, balancer_id, server_id, server_name, client_ip, duration_ms, created_at
           FROM request_logs
           WHERE balancer_id = $1
           ORDER BY id DESC
           LIMIT 50`,
          [b.id]
        );

        const totalRequests = serversRes.rows.reduce((sum, s) => sum + s.request_count, 0);

        const serversWithShare = serversRes.rows.map((s) => ({
          ...s,
          share_percent: totalRequests > 0 ? Number(((s.request_count / totalRequests) * 100).toFixed(1)) : 0
        }));

        return {
          ...b,
          total_requests: totalRequests,
          servers: serversWithShare,
          recent_logs: logsRes.rows
        };
      })
    );

    res.json(balancers);
  } catch (err) {
    console.error('List balancers error:', err);
    res.status(500).json({ error: 'Failed to retrieve load balancers' });
  }
});

// Create balancer with 3-6 servers
app.post('/api/balancers', async (req, res) => {
  const { name, algorithm, servers } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Balancer name is required' });
  }

  const validAlgorithms = ['round_robin', 'weighted_round_robin', 'least_connections', 'ip_hash'];
  const chosenAlgorithm = validAlgorithms.includes(algorithm) ? algorithm : 'round_robin';

  if (!Array.isArray(servers) || servers.length < 3 || servers.length > 6) {
    return res.status(400).json({ error: 'A balancer must be created with between 3 and 6 servers' });
  }

  for (const s of servers) {
    if (!s.name || !s.name.trim()) {
      return res.status(400).json({ error: 'Every server must have a name' });
    }
    const weight = parseInt(s.weight, 10);
    if (isNaN(weight) || weight < 1 || weight > 10) {
      return res.status(400).json({ error: 'Server weight must be an integer between 1 and 10' });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const balancerRes = await client.query(
      'INSERT INTO balancers (user_id, name, algorithm) VALUES ($1, $2, $3) RETURNING *',
      [req.user.userId, name.trim(), chosenAlgorithm]
    );
    const balancer = balancerRes.rows[0];

    const insertedServers = [];
    for (const s of servers) {
      const isHealthy = s.is_healthy !== undefined ? Boolean(s.is_healthy) : true;
      const sRes = await client.query(
        `INSERT INTO servers (balancer_id, name, weight, is_healthy, request_count)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING *`,
        [balancer.id, s.name.trim(), parseInt(s.weight, 10), isHealthy]
      );
      insertedServers.push({ ...sRes.rows[0], share_percent: 0 });
    }

    await client.query('COMMIT');
    res.status(201).json({
      ...balancer,
      total_requests: 0,
      servers: insertedServers,
      recent_logs: []
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create balancer error:', err);
    res.status(500).json({ error: 'Failed to create load balancer' });
  } finally {
    client.release();
  }
});

// Update balancer algorithm
app.patch('/api/balancers/:id/algorithm', async (req, res) => {
  const { id } = req.params;
  const { algorithm } = req.body;
  const validAlgorithms = ['round_robin', 'weighted_round_robin', 'least_connections', 'ip_hash'];

  if (!validAlgorithms.includes(algorithm)) {
    return res.status(400).json({ error: `Invalid algorithm. Must be one of: ${validAlgorithms.join(', ')}` });
  }

  try {
    const result = await db.query(
      'UPDATE balancers SET algorithm = $1 WHERE id = $2 RETURNING *',
      [algorithm, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Balancer not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update algorithm error:', err);
    res.status(500).json({ error: 'Failed to update algorithm' });
  }
});

// Toggle server health or update weight
app.patch('/api/balancers/:balancerId/servers/:serverId', async (req, res) => {
  const { balancerId, serverId } = req.params;
  const { is_healthy, weight } = req.body;

  try {
    const current = await db.query('SELECT * FROM servers WHERE id = $1 AND balancer_id = $2', [serverId, balancerId]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const newHealthy = is_healthy !== undefined ? Boolean(is_healthy) : current.rows[0].is_healthy;
    let newWeight = current.rows[0].weight;
    if (weight !== undefined) {
      const parsedWeight = parseInt(weight, 10);
      if (isNaN(parsedWeight) || parsedWeight < 1 || parsedWeight > 10) {
        return res.status(400).json({ error: 'Weight must be between 1 and 10' });
      }
      newWeight = parsedWeight;
    }

    const result = await db.query(
      `UPDATE servers SET is_healthy = $1, weight = $2 WHERE id = $3 AND balancer_id = $4 RETURNING *`,
      [newHealthy, newWeight, serverId, balancerId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update server error:', err);
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// Reset stats for a balancer
app.post('/api/balancers/:id/reset', async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE servers SET request_count = 0 WHERE balancer_id = $1', [id]);
    await client.query('DELETE FROM request_logs WHERE balancer_id = $1', [id]);
    await client.query('COMMIT');
    res.json({ message: 'Stats reset successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset stats error:', err);
    res.status(500).json({ error: 'Failed to reset stats' });
  } finally {
    client.release();
  }
});

// Run simulation: Send N requests (1-100)
app.post('/api/balancers/:id/simulate', async (req, res) => {
  const { id } = req.params;
  const count = parseInt(req.body.count, 10);

  if (isNaN(count) || count < 1 || count > 100) {
    return res.status(400).json({ error: 'Request count must be an integer between 1 and 100' });
  }

  try {
    const balancerRes = await db.query('SELECT * FROM balancers WHERE id = $1', [id]);
    if (balancerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Balancer not found' });
    }
    const balancer = balancerRes.rows[0];
    const algorithm = req.body.algorithm || balancer.algorithm;

    const allServersRes = await db.query(
      'SELECT * FROM servers WHERE balancer_id = $1 ORDER BY id ASC',
      [id]
    );

    if (allServersRes.rows.length === 0) {
      return res.status(400).json({ error: 'No servers configured for this balancer' });
    }

    const healthyServers = allServersRes.rows.filter(s => s.is_healthy);
    if (healthyServers.length === 0) {
      return res.status(503).json({ error: '503 Service Unavailable: All backend servers are unhealthy' });
    }

    // Prepare simulation structures
    // Server state tracking for virtual clock
    const serverMap = new Map();
    healthyServers.forEach(s => {
      serverMap.set(s.id, {
        id: s.id,
        name: s.name,
        weight: s.weight,
        current_weight: 0,
        added_requests: 0,
        active_requests_end_times: [] // Array of virtual finish times
      });
    });

    const simulatedLogs = [];
    let rrCounter = 0;

    // Run virtual clock simulation:
    // Arrival interval = 50ms
    // Duration = random 100 - 500ms
    for (let i = 0; i < count; i++) {
      const virtualArrivalMs = i * 50;
      const durationMs = Math.floor(Math.random() * (500 - 100 + 1)) + 100;
      const virtualFinishMs = virtualArrivalMs + durationMs;

      // Generate random client IP
      const clientIp = `192.168.${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 254) + 1}`;

      let chosenServer = null;

      if (algorithm === 'round_robin') {
        const idx = rrCounter % healthyServers.length;
        chosenServer = serverMap.get(healthyServers[idx].id);
        rrCounter++;
      } else if (algorithm === 'weighted_round_robin') {
        // Smooth weighted round-robin
        const totalWeight = healthyServers.reduce((sum, s) => sum + s.weight, 0);
        let maxWeightServer = null;

        for (const s of healthyServers) {
          const state = serverMap.get(s.id);
          state.current_weight += state.weight;
          if (!maxWeightServer || state.current_weight > maxWeightServer.current_weight) {
            maxWeightServer = state;
          }
        }

        chosenServer = maxWeightServer;
        chosenServer.current_weight -= totalWeight;
      } else if (algorithm === 'least_connections') {
        // Find server with least active connections at virtualArrivalMs
        let minConn = Infinity;
        let candidate = null;

        for (const s of healthyServers) {
          const state = serverMap.get(s.id);
          // Clean up finished requests
          state.active_requests_end_times = state.active_requests_end_times.filter(t => t > virtualArrivalMs);
          const activeCount = state.active_requests_end_times.length;

          if (activeCount < minConn) {
            minConn = activeCount;
            candidate = state;
          }
        }
        chosenServer = candidate || serverMap.get(healthyServers[0].id);
      } else if (algorithm === 'ip_hash') {
        let hash = 0;
        for (let c = 0; c < clientIp.length; c++) {
          hash = (hash * 31 + clientIp.charCodeAt(c)) & 0xffffffff;
        }
        const idx = Math.abs(hash) % healthyServers.length;
        chosenServer = serverMap.get(healthyServers[idx].id);
      } else {
        // fallback to round robin
        const idx = rrCounter % healthyServers.length;
        chosenServer = serverMap.get(healthyServers[idx].id);
        rrCounter++;
      }

      chosenServer.added_requests += 1;
      chosenServer.active_requests_end_times.push(virtualFinishMs);

      simulatedLogs.push({
        balancer_id: parseInt(id, 10),
        server_id: chosenServer.id,
        server_name: chosenServer.name,
        client_ip: clientIp,
        duration_ms: durationMs
      });
    }

    // Persist in DB
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Update server counts
      for (const [serverId, state] of serverMap.entries()) {
        if (state.added_requests > 0) {
          await client.query(
            'UPDATE servers SET request_count = request_count + $1 WHERE id = $2',
            [state.added_requests, serverId]
          );
        }
      }

      // Insert request logs
      for (const log of simulatedLogs) {
        await client.query(
          `INSERT INTO request_logs (balancer_id, server_id, server_name, client_ip, duration_ms)
           VALUES ($1, $2, $3, $4, $5)`,
          [log.balancer_id, log.server_id, log.server_name, log.client_ip, log.duration_ms]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      message: `Successfully processed ${count} requests`,
      processed_count: count,
      algorithm_used: algorithm,
      logs: simulatedLogs.slice(-50)
    });
  } catch (err) {
    console.error('Simulate error:', err);
    res.status(500).json({ error: 'Failed to run request simulation' });
  }
});

async function start() {
  await db.connectWithRetry();
  await seedAdminUser();

  // Seed default balancer if none exists
  try {
    const adminUser = await db.query('SELECT id FROM users WHERE email = $1', ['admin@demo.com']);
    if (adminUser.rows.length > 0) {
      const bRes = await db.query('SELECT id FROM balancers LIMIT 1');
      if (bRes.rows.length === 0) {
        const newB = await db.query(
          'INSERT INTO balancers (user_id, name, algorithm) VALUES ($1, $2, $3) RETURNING id',
          [adminUser.rows[0].id, 'Production App Balancer', 'round_robin']
        );
        const bId = newB.rows[0].id;
        const initialServers = [
          { name: 'app-srv-01', weight: 3, is_healthy: true },
          { name: 'app-srv-02', weight: 2, is_healthy: true },
          { name: 'app-srv-03', weight: 1, is_healthy: true },
          { name: 'app-srv-04', weight: 2, is_healthy: true },
        ];
        for (const s of initialServers) {
          await db.query(
            'INSERT INTO servers (balancer_id, name, weight, is_healthy, request_count) VALUES ($1, $2, $3, $4, 0)',
            [bId, s.name, s.weight, s.is_healthy]
          );
        }
        console.log('Seeded default load balancer with 4 servers');
      }
    }
  } catch (e) {
    console.error('Seeding balancer error:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`Load Balancer Backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
