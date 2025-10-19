const { scrapeAndSaveCharacters, updateCharacterImages } = require('./scraper');

/**
 * Creates the characters table if it doesn't exist (matching your existing schema)
 * @param {Object} pool - PostgreSQL connection pool
 */
const createCharactersTable = async (pool) => {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS characters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(30) NOT NULL,
        last_name VARCHAR(30),
        title VARCHAR(30),
        image_path VARCHAR(128),
        elo INTEGER DEFAULT 1000,
        rating INTEGER DEFAULT 1000,
        recent_change INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0
      );
    `;
    
    await pool.query(createTableQuery);
    console.log('Characters table created successfully');
  } catch (error) {
    console.error('Error creating characters table:', error.message);
    throw error;
  }
};

/**
 * Populates the characters table with scraped One Piece data
 * @param {Object} pool - PostgreSQL connection pool
 */
const populateCharacters = async (pool) => {
  try {
    console.log('Starting to populate characters table...');
    await createCharactersTable(pool);
    const result = await scrapeAndSaveCharacters(pool);
    console.log('Characters table populated successfully');
    return result;
  } catch (error) {
    console.error('Error populating characters table:', error.message);
    throw error;
  }
};

/**
 * Updates character images by scraping individual character pages
 * @param {Object} pool - PostgreSQL connection pool
 * @param {number} delay - Delay between requests in milliseconds (default: 1000ms)
 */
const updateCharacterImagesFromPages = async (pool, delay = 1000) => {
  try {
    console.log('Starting character image update process...');
    const result = await updateCharacterImages(pool, delay);
    console.log('Character image update completed successfully');
    return result;
  } catch (error) {
    console.error('Error updating character images:', error.message);
    throw error;
  }
};

module.exports = {
  createCharactersTable,
  populateCharacters,
  updateCharacterImagesFromPages
};