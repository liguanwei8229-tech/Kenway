# AI 选题雷达 —— 容器化部署
FROM node:24-alpine

WORKDIR /app
COPY . .

ENV PORT=8787 \
    REFRESH_MIN=30 \
    MAX_AGE_H=72

EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "server.js"]
