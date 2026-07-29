const jwt = require('jsonwebtoken');
const db = require('../db');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

// Per-tool permission middleware
// Checks user_tool_permissions table for the given tool and minimum level
// Superadmins and admins bypass the check
// If no explicit permission row exists, defaults to 'standard'
function requireToolPermission(tool, minLevel) {
  const levels = { none: 0, read_only: 1, standard: 2, admin: 3 };
  return async (req, res, next) => {
    try {
      // Superadmins and admins bypass tool-level checks
      if (req.user?.role === 'superadmin' || req.user?.role === 'admin') return next();

      // Determine project_id from params, query, or body
      const projectId = req.params.projectId || req.params.project_id
        || req.query.project_id || req.body?.project_id;

      if (!projectId) {
        return res.status(400).json({ error: 'project_id required for permission check' });
      }

      const perm = await db.query(
        `SELECT permission_level FROM user_tool_permissions
         WHERE project_id = $1 AND user_id = $2 AND tool = $3`,
        [projectId, req.user.id, tool]
      );

      // Default when no explicit permission row exists. Historically this was
      // 'standard' (permissive). Set DEFAULT_TOOL_PERMISSION=none for secure
      // deny-by-default once per-user permission rows are populated.
      const fallbackLevel = process.env.DEFAULT_TOOL_PERMISSION || 'standard';
      const userLevel = perm.rows[0] ? perm.rows[0].permission_level : fallbackLevel;

      if ((levels[userLevel] || 0) < (levels[minLevel] || 0)) {
        return res.status(403).json({ error: 'Insufficient permissions for ' + tool });
      }

      // Attach permission info to request for downstream use
      req.toolPermission = {
        tool,
        level: userLevel,
        granular: perm.rows[0]?.granular_perms || {}
      };

      next();
    } catch (err) {
      console.error('Tool permission check error:', err.message);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { authenticate, requireRole, requireToolPermission };
