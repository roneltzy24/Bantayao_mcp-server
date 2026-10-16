module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "dist/index.js",
      cwd: __dirname,
      autorestart: true,
    },
  ],
};