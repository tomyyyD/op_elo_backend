const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const Pool = require('pg').Pool;
const axios = require('axios');
const { populateCharacters, updateCharacterImagesFromPages } = require('./database_tools');

const app = express();
const port = 3000;

dotenv.config();
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const getUsers = (request, response) => {
  pool.query('SELECT * FROM users ORDER BY id ASC', (error, results) => {
    if (error) {
      throw error;
    }
    response.status(200).json(results.rows);
  });
};

const getUserById = (request, response) => {
  const id = parseInt(request.params.id);
  pool.query('SELECT * FROM users WHERE id = $1', [id], (error, results) => {
    if (error) {
      throw error;
    }
    response.status(200).json(results.rows);
  });
};

const getCharacters = (request, response) => {
  pool.query('SELECT * FROM characters ORDER BY first_name ASC', (error, results) => {
    if (error) {
      throw error;
    }
    response.status(200).json(results.rows);
  });
};

const getCharacterById = (request, response) => {
  const id = parseInt(request.params.id);
  pool.query('SELECT * FROM characters WHERE id = $1', [id], (error, results) => {
    if (error) {
      throw error;
    }
    response.status(200).json(results.rows);
  });
};

const updateCharacterElo = (request, response) => {
  const id = request.params.id;
  const { wins, losses, elo, recent_change } = request.body;
  
  // Validate that only the allowed fields are provided
  const allowedFields = ['wins', 'losses', 'elo', 'recent_change'];
  const providedFields = Object.keys(request.body);
  const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
  
  if (invalidFields.length > 0) {
    return response.status(400).json({
      error: 'Invalid fields provided',
      message: `Only the following fields are allowed: ${allowedFields.join(', ')}`,
      invalidFields: invalidFields
    });
  }
  
  // Build dynamic query based on provided fields
  const updateFields = [];
  const values = [];
  let paramCount = 1;
  
  if (wins !== undefined) {
    updateFields.push(`wins = $${paramCount}`);
    values.push(wins);
    paramCount++;
  }
  
  if (losses !== undefined) {
    updateFields.push(`losses = $${paramCount}`);
    values.push(losses);
    paramCount++;
  }
  
  if (elo !== undefined) {
    updateFields.push(`elo = $${paramCount}`);
    values.push(elo);
    paramCount++;
  }
  
  if (recent_change !== undefined) {
    updateFields.push(`recent_change = $${paramCount}`);
    values.push(recent_change);
    paramCount++;
  }
  
  if (updateFields.length === 0) {
    return response.status(400).json({
      error: 'No valid fields provided',
      message: 'At least one of the following fields must be provided: wins, losses, elo, recent_change'
    });
  }
  
  // Add the character ID as the last parameter
  values.push(id);
  
  const query = `UPDATE characters SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  
  pool.query(query, values, (error, results) => {
    if (error) {
      console.error('Error updating character ELO:', error);
      return response.status(500).json({
        error: 'Failed to update character',
        message: error.message
      });
    }
    
    if (results.rows.length === 0) {
      return response.status(404).json({
        error: 'Character not found',
        message: `No character found with id: ${id}`
      });
    }
    
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

app.get('/users', getUsers);
app.get('/users/:id', getUserById);

app.get('/characters', getCharacters);
app.get('/characters/:id', getCharacterById);
app.put('/characters/:id/elo', updateCharacterElo);
app.post('/scrape-characters', scrapeCharacters);
app.post('/update-character-images', updateCharacterImages);

app.get('/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    // console.log(`Proxying image: ${imageUrl}`);
    
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
    console.error('Error proxying image:', error.message);
    
    if (error.response && error.response.status === 404) {
      res.status(404).json({ error: 'Image not found' });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to fetch image' });
    }
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});