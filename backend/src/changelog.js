const pool = require('./db');

async function logChange(projectId, entityType, entityId, action, fieldName, oldValue, newValue, userId, ipAddress) {
  try {
    // Write to audit_log (new schema)
    await pool.query(
      `INSERT INTO audit_log (project_id, entity_type, entity_id, action, field_name, old_value, new_value, changed_by, changed_at, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
      [projectId, entityType, entityId, action, fieldName,
       oldValue ? String(oldValue) : null, newValue ? String(newValue) : null, userId, ipAddress || null]
    );
    // Also write to legacy changelog for backward compat
    const actionMap = { created: 'CREATE', updated: 'UPDATE', deleted: 'DELETE', status_changed: 'UPDATE', commented: 'CREATE', assigned: 'UPDATE', uploaded: 'CREATE', approved: 'UPDATE', rejected: 'UPDATE', submitted: 'UPDATE' };
    await pool.query(
      "INSERT INTO changelog (table_name, record_id, operation, field_changed, old_value, new_value, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
      [entityType, entityId, actionMap[action] || 'UPDATE', fieldName, oldValue ? String(oldValue) : null, newValue ? String(newValue) : null, userId]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logChange };
