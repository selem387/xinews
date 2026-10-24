# Íconos PNG generados desde el SVG en la construcción
FROM alpine:3.20 AS icons
RUN apk add --no-cache rsvg-convert font-dejavu
COPY icons/icon.svg /icon.svg
RUN rsvg-convert -w 192 -h 192 /icon.svg -o /icon-192.png && rsvg-convert -w 512 -h 512 /icon.svg -o /icon-512.png

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
COPY --from=icons /icon-192.png /icon-512.png /usr/share/nginx/html/icons/
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf
EXPOSE 80
