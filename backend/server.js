const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const assessmentRoutes = require('./src/routes/assessments');

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
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
