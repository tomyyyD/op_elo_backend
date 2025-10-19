const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes One Piece character data from the Fandom wiki
 * @returns {Promise<Array>} Array of character objects with name and image_path
 */
async function scrapeOnePieceCharacters() {
  try {
    console.log('Starting to scrape One Piece characters...');
    
    const response = await axios.get('https://onepiece.fandom.com/wiki/List_of_Canon_Characters', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const characters = [];

    // The characters are in a table with specific structure
    // Looking for the main character table
    $('table tr').each((index, element) => {
      const $row = $(element);
      const $cells = $row.find('td');
      
      if ($cells.length >= 2) {
        // Try different column positions for the name
        for (let i = 0; i < Math.min($cells.length, 5); i++) {
          const nameCell = $cells.eq(i);
          const nameLink = nameCell.find('a').first();
          const characterName = nameLink.text().trim();
          
          if (characterName && characterName !== 'Name' && characterName.length > 1) {
            // Clean up the character name
            const cleanName = characterName.replace(/\s+/g, ' ').trim();
            
            if (cleanName && cleanName.length > 1) {
              // Try to find an image for the character
              let imagePath = null;
              const imgElement = $row.find('img').first();
              if (imgElement.length) {
                imagePath = imgElement.attr('src') || imgElement.attr('data-src');
              }
              
              characters.push({
                first_name: cleanName,
                last_name: '', // Empty as requested
                title: '', // Empty as requested
                image_path: imagePath,
                elo: 1000, // Default ELO
                rank: 1000, // Default rank (matching your schema)
                recent_change: 0,
                wins: 0,
                losses: 0
              });
              
              // Only take the first valid character per row to avoid duplicates
              break;
            }
          }
        }
      }
    });

    console.log(`Successfully scraped ${characters.length} characters`);
    return characters;

  } catch (error) {
    console.error('Error scraping One Piece characters:', error.message);
    throw error;
  }
}

/**
 * Scrapes characters and saves them to the database
 * @param {Object} pool - PostgreSQL connection pool
 */
async function scrapeAndSaveCharacters(pool) {
  try {
    const characters = await scrapeOnePieceCharacters();
    
    if (characters.length === 0) {
      return characters;
    }
    
    // Clear existing characters (optional - you might want to keep existing data)
    await pool.query('DELETE FROM characters');
    
    // Insert new characters
    for (const character of characters) {
      await pool.query(
        'INSERT INTO characters (first_name, last_name, title, image_path, elo, rank, recent_change, wins, losses) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          character.first_name, 
          character.last_name, 
          character.title, 
          character.image_path, 
          character.elo, 
          character.rank, 
          character.recent_change,
          character.wins,
          character.losses
        ]
      );
    }
    
    console.log(`Successfully saved ${characters.length} characters to database`);
    return characters;
    
  } catch (error) {
    console.error('Error saving characters to database:', error.message);
    throw error;
  }
}

/**
 * Scrapes a specific character's image from their individual page
 * @param {string} characterName - The character's name
 * @returns {Promise<string|null>} The image URL or null if not found
 */
async function scrapeCharacterImage(characterName) {
  try {
    // Convert character name to URL format (spaces to underscores)
    const urlName = characterName.replace(/\s+/g, '_');
    const characterUrl = `https://onepiece.fandom.com/wiki/${encodeURIComponent(urlName)}`;
    
    console.log(`Scraping image for character: ${characterName} from ${characterUrl}`);
    
    const response = await axios.get(characterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    // Look for image with pi-image-thumbnail class
    const thumbnailImg = $('img.pi-image-thumbnail').first();
    
    if (thumbnailImg.length) {
      const imageUrl = thumbnailImg.attr('src') || thumbnailImg.attr('data-src');
      if (imageUrl) {
        console.log(`Found image for ${characterName}: ${imageUrl}`);
        return imageUrl;
      }
    }
    
    console.log(`No image found for character: ${characterName}`);
    return null;
    
  } catch (error) {
    console.error(`Error scraping image for character ${characterName}:`, error.message);
    return null;
  }
}

/**
 * Updates character images in the database by scraping individual character pages
 * @param {Object} pool - PostgreSQL connection pool
 * @param {number} delay - Delay between requests in milliseconds (default: 1000ms)
 * @returns {Promise<Object>} Summary of updates
 */
async function updateCharacterImages(pool, delay = 1000) {
  try {
    console.log('Starting to update character images...');
    
    // Get all characters from the database
    const result = await pool.query('SELECT id, first_name, image_path FROM characters ORDER BY first_name');
    const characters = result.rows;
    
    console.log(`Found ${characters.length} characters to update`);
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const character of characters) {
      try {
        // Add delay between requests to be respectful to the server
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const imageUrl = await scrapeCharacterImage(character.first_name);
        
        if (imageUrl) {
          // Update the character's image_path in the database
          await pool.query(
            'UPDATE characters SET image_path = $1 WHERE id = $2',
            [imageUrl, character.id]
          );
          updated++;
          console.log(`Updated image for ${character.first_name}`);
        } else {
          skipped++;
          console.log(`Skipped ${character.first_name} - no image found`);
        }
        
      } catch (error) {
        failed++;
        console.error(`Failed to update ${character.first_name}:`, error.message);
      }
    }
    
    const summary = {
      total: characters.length,
      updated,
      skipped,
      failed,
      timestamp: new Date().toISOString()
    };
    
    console.log('Character image update summary:', summary);
    return summary;
    
  } catch (error) {
    console.error('Error updating character images:', error.message);
    throw error;
  }
}

module.exports = {
  scrapeOnePieceCharacters,
  scrapeAndSaveCharacters,
  scrapeCharacterImage,
  updateCharacterImages
};
