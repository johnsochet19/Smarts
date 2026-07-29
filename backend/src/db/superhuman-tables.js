const db = require('./index');

async function createSuperhumanTables() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS email_tracking (
      id SERIAL PRIMARY KEY,
      message_id VARCHAR(255) NOT NULL,
      pixel_id VARCHAR(100) UNIQUE NOT NULL,
      recipient VARCHAR(255),
      subject VARCHAR(500),
      opened BOOLEAN DEFAULT false,
      opened_at TIMESTAMP,
      open_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_snippets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      shortcut VARCHAR(50),
      content TEXT NOT NULL,
      category VARCHAR(50) DEFAULT 'general',
      use_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_comments (
      id SERIAL PRIMARY KEY,
      thread_id VARCHAR(255) NOT NULL,
      message_id VARCHAR(255),
      author VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_contacts (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      company VARCHAR(255),
      notes TEXT,
      last_contacted TIMESTAMP,
      email_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_metrics (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      emails_sent INTEGER DEFAULT 0,
      emails_received INTEGER DEFAULT 0,
      emails_archived INTEGER DEFAULT 0,
      avg_response_time INTEGER DEFAULT 0,
      inbox_zero_streak INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(date)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_snoozes (
      id SERIAL PRIMARY KEY,
      message_id VARCHAR(255) NOT NULL,
      thread_id VARCHAR(255),
      wake_at TIMESTAMP NOT NULL,
      processed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS email_scheduled_sends (
      id SERIAL PRIMARY KEY,
      to_address VARCHAR(500) NOT NULL,
      subject VARCHAR(500),
      body TEXT,
      send_at TIMESTAMP NOT NULL,
      sent BOOLEAN DEFAULT false,
      thread_id VARCHAR(255),
      in_reply_to VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    console.log('Superhuman tables ready');
  } catch (err) {
    console.error('Superhuman tables migration error:', err.message);
  }
}

module.exports = createSuperhumanTables;
