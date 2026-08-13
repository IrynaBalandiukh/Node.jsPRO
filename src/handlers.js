export const parseHeaders = (data) => {
  const [requestLine, ...headerLines] = data.split("\r\n");

  const [method, path] = requestLine.split(" ");

  const headers = headerLines.reduce((acc, line) => {
    const i = line.indexOf(":");
    if (i === -1) {
      return acc;
    }

    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();

    if (!key) {
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});

  return {
    method,
    path,
    headers,
  };
};

export const sendResponse = (socket, statusCode, statusText, headers, body) => {
  let responseLine = `HTTP/1.1 ${statusCode} ${statusText}\r\n`;

  Object.entries(headers).forEach(([key, value]) => {
    responseLine += `${key}: ${value}\r\n`;
  });

  responseLine += `\r\n${body}`;

  socket.write(responseLine);
  socket.end();
};
