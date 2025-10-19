const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const Pool = require('pg').Pool;
const axios = require('axios');
const cors = require('cors');
const { populateCharacters, updateCharacterImagesFromPages } = require('./database_tools');

const app = express();
const port = process.env.PORT || 3000;

dotenv.config();
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    require: true
  } : false
});

// Handle database connection errors
pool.on('error', (err) => {
  console.error('[ERROR]: Unexpected database error:', err.message);
  console.error('Database connection lost. Attempting to reconnect...');
});

// Test database connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('[ERROR]: Failed to connect to database on startup:', err.message);
    process.exit(1); // Exit if we can't connect to the database
  } else {
    console.log('[SUCCESS]: Database connected successfully');
    release();
  }
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cors({
  origin: ['https://op-elo.onrender.com', 'http://localhost:5173'],
  credentials: true
}));

function calculateChange(eloChange, recentChange) {  
  // Check if both changes have the same sign (both positive, both negative, or one is zero)
  if ((eloChange >= 0 && recentChange >= 0) || (eloChange <= 0 && recentChange <= 0)) {
    return recentChange + eloChange;
  } else {
    return eloChange;
  }
}

const getCharacters = (request, response) => {
  pool.query('SELECT * FROM characters ORDER BY elo DESC, first_name ASC', (error, results) => {
    if (error) {
      console.error("[ERROR]: cannot SELECT from characters table:", error.message);
      return response.status(500).json({
        error: "Database error",
        message: "Failed to retrieve characters"
      });
    }
    response.status(200).json(results.rows);
  });
};

const getCharacterById = (request, response) => {
  const id = request.params.id;
  
  if (!id || id.trim() === '') {
    console.error("[ERROR]: Invalid character ID provided:", id);
    return response.status(400).json({
      error: "Invalid input",
      message: "Character ID is required"
    });
  }
  
  pool.query('SELECT * FROM characters WHERE id = $1', [id], (error, results) => {
    if (error) {
      console.error("[ERROR]: cannot SELECT character by ID:", error.message);
      return response.status(500).json({
        error: "Database error",
        message: "Failed to retrieve character"
      });
    }
    response.status(200).json(results.rows);
  });
};

const updateCharacterElo = (request, response) => {
  const id = request.params.id;
  const { wins_change, losses_change, elo_change, recent_change } = request.body;
  
  // Validate character ID
  if (!id || id.trim() === '') {
    console.error("[ERROR]: Invalid character ID provided:", id);
    return response.status(400).json({
      error: "Invalid input",
      message: "Character ID is required"
    });
  }
  
  // Validate that all required fields are present
  if (wins_change === undefined || losses_change === undefined || elo_change === undefined || recent_change === undefined) {
    console.error(`[ERROR]: missing fields for character ${id}`);
    return response.status(400).json({
      error: 'Missing required fields',
      message: 'All fields are required: wins_change, losses_change, elo_change, recent_change'
    });
  }
  
  // Validate that the changes are numbers
  if (isNaN(wins_change) || isNaN(losses_change) || isNaN(elo_change) || isNaN(recent_change)) {
    console.error(`[ERROR]: non-numeric values provided for character ${id}`);
    return response.status(400).json({
      error: 'Invalid input',
      message: 'All change values must be numbers'
    });
  }
  
  // Validate that no extra fields are provided
  const allowedFields = ['wins_change', 'losses_change', 'elo_change', 'recent_change'];
  const providedFields = Object.keys(request.body);
  const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
  
  if (invalidFields.length > 0) {
    console.error(`[ERROR]: invalid fields provided for character ${id}:`, invalidFields);
    return response.status(400).json({
      error: 'Invalid fields provided',
      message: `Only these fields are allowed: ${allowedFields.join(', ')}`,
      invalidFields: invalidFields
    });
  }
  
  const last_change = calculateChange(elo_change, recent_change);
  
  // Use incremental updates to prevent race conditions
  const query = `
    UPDATE characters 
    SET 
      wins = wins + $1, 
      losses = losses + $2, 
      elo = elo + $3, 
      recent_change = $4 
    WHERE id = $5 
    RETURNING *`;
  
  pool.query(query, [wins_change, losses_change, elo_change, last_change, id], (error, results) => {
    if (error) {
      console.error(`[ERROR]: Failed to update character ${id}:`, error.message);
      return response.status(500).json({
        error: 'Database error',
        message: 'Failed to update character'
      });
    }
    
    if (results.rows.length === 0) {
      console.error(`[ERROR]: Character not found: ${id}`);
      return response.status(404).json({
        error: 'Character not found',
        message: `No character found with id: ${id}`
      });
    }
    
    console.log(`[SUCCESS]: Updated character ${results.rows[0].first_name} (${id})`);
    response.status(200).json({
      message: 'Character ELO updated successfully',
      character: results.rows[0]
    });
  });
};

const scrapeCharacters = async (request, response) => {
  try {
    await populateCharacters(pool);
    response.status(200).json({ 
      message: 'Characters scraped and saved successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error scraping characters:', error);
    response.status(500).json({ 
      error: 'Failed to scrape characters',
      message: error.message 
    });
  }
};

const updateCharacterImages = async (request, response) => {
  try {
    // Get delay from query parameter or use default of 1000ms
    const delay = parseInt(request.query.delay) || 1000;
    
    console.log(`Starting character image update with ${delay}ms delay between requests...`);
    const result = await updateCharacterImagesFromPages(pool, delay);
    
    response.status(200).json({ 
      message: 'Character images updated successfully',
      summary: result
    });
  } catch (error) {
    console.error('Error updating character images:', error);
    response.status(500).json({ 
      error: 'Failed to update character images',
      message: error.message 
    });
  }
};

app.get('/characters', getCharacters);
app.get('/characters/:id', getCharacterById);
app.put('/characters/:id/elo', updateCharacterElo);

app.post('/scrape-characters', scrapeCharacters);
app.post('/update-character-images', updateCharacterImages);

app.get('/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
      console.error("[ERROR]: Image proxy called without URL parameter");
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    console.log(`[INFO]: Proxying image: ${imageUrl}`);
    
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; bot)',
        'Referer': 'https://onepiece.fandom.com/'
      },
      timeout: 10000 // 10 second timeout
    });
    
    // Set appropriate headers
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS
    
    // Pipe the image data to the response
    response.data.pipe(res);
    
  } catch (error) {
    console.error('[ERROR]: Error proxying image:', error.message);
    
    if (error.response && error.response.status === 404) {
      res.status(404).json({ error: 'Image not found' });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Request timeout' });
    } else if (error.code === 'ENOTFOUND') {
      res.status(400).json({ error: 'Invalid URL or host not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch image' });
    }
  }
});

// Global error handler for unhandled errors
app.use((error, req, res, next) => {
  console.error('[ERROR]: Unhandled error:', error.message);
  console.error(error.stack);
  
  if (res.headersSent) {
    return next(error);
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  console.error(`[ERROR]: 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Route not found',
    message: `The requested route ${req.method} ${req.originalUrl} does not exist`
  });
});

app.listen(port, () => {
  console.log(`[SUCCESS]: Server is running on port ${port}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[FATAL]: Uncaught Exception:', error.message);
  console.error(error.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL]: Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[INFO]: Received SIGINT. Graceful shutdown...');
  pool.end(() => {
    console.log('[INFO]: Database connections closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[INFO]: Received SIGTERM. Graceful shutdown...');
  pool.end(() => {
    console.log('[INFO]: Database connections closed.');
    process.exit(0);
  });
});