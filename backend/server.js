const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const assessmentRoutes = require('./src/routes/assessments');

const app = express();
const PORT = process.env.PORT || 5000;

const configuredOrigins = [
    process.env.CLIENT_URL,
    ...(process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
].filter(Boolean);

function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (configuredOrigins.includes(origin)) return true;
    if (origin.endsWith('.onrender.com')) return true;
    return false;
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/assessments', assessmentRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'BoardPack API', version: '1.0.0' }));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`\n🏛️  BoardPack API running on http://localhost:${PORT}`);
    console.log(`📋  Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
