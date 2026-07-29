const db = require('./index');

async function logChange({ tableName, recordId, operation, fieldChanged, oldValue, newValue, userId }) {
  try {
    await db.query(
      `INSERT INTO changelog (table_name, record_id, operation, field_changed, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tableName, recordId, operation, fieldChanged || null, oldValue || null, newValue || null, userId]
    );
  } catch (err) {
    console.error('Changelog error:', err.message);
  }
}

async function logAllChanges({ tableName, recordId, oldRecord, newData, userId }) {
  for (const [key, val] of Object.entries(newData)) {
    const oldVal = oldRecord[key];
    if (String(oldVal) !== String(val)) {
      await logChange({
        tableName,
        recordId,
        operation: 'UPDATE',
        fieldChanged: key,
        oldValue: String(oldVal),
        newValue: String(val),
        userId
      });
    }
  }
}

module.exports = { logChange, logAllChanges };
