const { ZodError } = require('zod');

const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params
    });
    req.body = parsed.body || req.body;
    req.query = parsed.query || req.query;
    req.params = parsed.params || req.params;
    next();
  } catch (err) {
    if (err instanceof ZodError || err.errors) {
      return res.status(400).json({
        success: false,
        message: 'Dữ liệu đầu vào không hợp lệ',
        errors: (err.errors || []).map((e) => ({
          path: e.path.join('.'),
          message: e.message
        }))
      });
    }
    next(err);
  }
};

module.exports = validate;