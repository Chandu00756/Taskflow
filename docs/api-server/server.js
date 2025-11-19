const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

// Read the swagger JSON file
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../proto/api.swagger.json'), 'utf8')
);

// Serve static files from docs directory
app.use('/static', express.static(path.join(__dirname, '..')));

// Swagger UI options
const swaggerOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Task Management System API',
  customfavIcon: '/static/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));

// Redirect root to API docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'API Documentation Server' });
});

// Serve markdown API reference as HTML
app.get('/reference', (req, res) => {
  const markdownPath = path.join(__dirname, '../api/API_REFERENCE.md');
  if (fs.existsSync(markdownPath)) {
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    res.type('text/plain').send(markdown);
  } else {
    res.status(404).send('API Reference not found');
  }
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('📚 Task Management System - API Documentation Server');
  console.log('='.repeat(60));
  console.log(`\n✅ Server running on: http://localhost:${PORT}`);
  console.log(`\n🔗 Available endpoints:`);
  console.log(`   • API Documentation:  http://localhost:${PORT}/api-docs`);
  console.log(`   • Health Check:       http://localhost:${PORT}/health`);
  console.log(`   • Markdown Reference: http://localhost:${PORT}/reference`);
  console.log('\n' + '='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  process.exit(0);
});
