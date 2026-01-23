FROM node:20-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar todas as dependências (incluindo dev para build)
RUN npm ci

# Copiar código fonte
COPY tsconfig.json ./
COPY src/ ./src/

# Compilar TypeScript
RUN npm run build

# Remover dependências de desenvolvimento
RUN npm prune --production

# Comando para iniciar o servidor
CMD ["node", "dist/index.js"]