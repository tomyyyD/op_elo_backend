const fs = require('fs')
const Pool = require('pg').Pool;
require('dotenv').config();

// function used for populating the prod database with the local characters
const PG_PASSWORD = process.env.PROD_PG_PASSWORD
const PG_USER = process.env.PROD_PG_USER
const PG_HOST = process.env.PROD_PG_HOST
const PG_DATABASE = process.env.PROD_PG_DATABASE
const PG_PORT = process.env.PROD_PG_PORT

const pool = new Pool({
  user: PG_USER,
  host: PG_HOST,
  database: PG_DATABASE,
  password: PG_PASSWORD,
  port: PG_PORT,
  ssl: {
    rejectUnauthorized: true,
    require: true
  }
});

// read the local JSON
const local_db = JSON.parse(fs.readFileSync("local_db.json", "utf-8"))

async function populateDatabase() {
  console.log(`Starting to populate database with ${local_db.length} characters...`);
  
  for (const entry of local_db) {
    const { first_name, image_path } = entry;
    try {
      await pool.query(
        "INSERT INTO characters (first_name, image_path, elo, recent_change, wins, losses) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          first_name,
          image_path,
          1000,
          0,
          0,
          0
        ]
      )
      console.log(`✓ Added ${first_name}`)
    } catch (error) {
      console.log(`✗ Failed to add ${first_name}:`, error.message)
    }
  }
  
  console.log("Successfully updated database");
  await pool.end(); // Close the connection
}

// Run the population function
populateDatabase().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});