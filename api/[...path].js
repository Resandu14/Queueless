const { handleApi, sendError } = require("../lib/api");

module.exports = async function handler(request, response) {
  try {
    const host = request.headers.host || "localhost";
    const url = new URL(request.url, `https://${host}`);
    await handleApi(request, response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendError(response, 500, "Unexpected server error.");
    else response.end();
  }
};
