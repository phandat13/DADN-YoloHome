const { ZodError } = require('zod');

const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (parsed.body !== undefined) req.body = parsed.body;
    if (parsed.query !== undefined) req.query = parsed.query;
    if (parsed.params !== undefined) req.params = parsed.params;

    next();
  } catch (err) {
    if (err instanceof ZodError || err?.issues || err?.errors) {
      // Hỗ trợ cả Zod 3 (err.errors) và Zod 4 (err.issues)
      const rawIssues = err.issues || err.errors || [];

      return res.status(400).json({
        success: false,
        message: 'Dữ liệu đầu vào không hợp lệ',
        errors: rawIssues.map((e) => ({
          path: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
          message: e.message,
        })),
      });
    }
    next(err);
  }
};

module.exports = validate;