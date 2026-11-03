# PlaySpace + PlaySpace: Wildlands

Primeira versão funcional (núcleo jogável) de uma plataforma de jogos com um protótipo voxel 3D em terceira pessoa.

## O que está implementado

- Plataforma responsiva com página inicial e catálogo de Wildlands.
- Cadastro e login com bcryptjs, sessão HTTP-only e limite de requisições.
- Persistência de contas/sessões/mundo via MongoDB quando `MONGODB_URI` está configurada.
- Modo sem MongoDB identificado como memória temporária; os dados são perdidos ao reiniciar.
- Mundo 3D Three.js com terreno procedural simples, árvores, água, blocos e câmera em terceira pessoa.
- Movimentação WASD, corrida, pulo, câmera pelo mouse; gestos touch por Pointer Events e botões de ação.
- Mineração, construção de blocos, inventário e salvamento local no navegador.
- Socket.IO: entrada/saída, posições de jogadores, chat e alterações de blocos compartilhadas.
- Testes unitários básicos para validação de blocos e nomes de sala.

## Limitações conhecidas desta versão

Este é um primeiro núcleo, não um jogo de sobrevivência completo. Ainda não há crafting, ferramentas/durabilidade, agricultura, criaturas, combate, fome/vida funcional, lista social/amigos, salas privadas, proprietário de mundos, conflito de salvamento ou autoridade completa do servidor sobre física/inventário. O servidor valida formato, limites e distância declarada para operações de bloco, mas a simulação de movimento ainda é principalmente cliente e não deve ser considerada anti-cheat. A sincronização do mundo usa estado em memória por processo e salvamento MongoDB periódico; para escalar a múltiplas instâncias Render será necessário um adaptador Socket.IO e estratégia de persistência/concorrência distribuída.

A física é deliberadamente simples e não substitui um motor físico dedicado. Colisões com blocos são básicas; declives, escadas e paredes podem exigir refinamento. O terreno é gerado no cliente e os blocos iniciais não são uma geração autoritativa compartilhada. O jogo usa Three.js via CDN, portanto o navegador precisa de internet para carregar a biblioteca.

Não foi possível testar em dispositivos Android físicos nesta entrega. Desempenho varia por aparelho e navegador.

## Requisitos

- Node.js 20 ou superior
- npm
- MongoDB Atlas (opcional em desenvolvimento; recomendado em produção)

## Executar localmente

```bash
npm install
cp .env.example .env
# Edite .env e defina SESSION_SECRET e, se desejar, MONGODB_URI
npm start
```

Abra `http://localhost:3000`.

Sem `MONGODB_URI`, o servidor inicia em modo temporário em memória. Em produção, configure obrigatoriamente `SESSION_SECRET` e `MONGODB_URI`.

## Testes

```bash
npm test
```

Os testes automatizados cobrem funções pequenas de validação. Eles não substituem testes end-to-end no navegador nem testes em Android real.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | Não | Porta fornecida pelo Render; padrão 3000 |
| `NODE_ENV` | Produção | Use `production` no Render |
| `SESSION_SECRET` | Sim em produção | Segredo longo e aleatório para sessões |
| `MONGODB_URI` | Recomendado | String de conexão MongoDB Atlas |

## MongoDB Atlas

1. Crie um cluster no MongoDB Atlas.
2. Crie um usuário de banco com senha forte.
3. Em Network Access, permita o acesso necessário para o Render (para teste, `0.0.0.0/0` é simples, mas menos restritivo; prefira restringir conforme sua política).
4. Copie a connection string do banco e substitua usuário/senha.
5. Configure `MONGODB_URI` nas variáveis do serviço Render. Não coloque a URI no código nem no GitHub.

## Publicar no GitHub pelo Android

1. Extraia o ZIP no celular.
2. No GitHub, crie um repositório vazio.
3. Abra o repositório no navegador e escolha **Add file → Upload files**.
4. Envie o conteúdo da pasta `playspace` mantendo a estrutura: `package.json`, `server.js`, `public/`, `test/` etc. na raiz do repositório. Não envie uma pasta externa duplicada como única raiz.
5. Confirme que `.env` e `node_modules` não foram enviados. O `.gitignore` já os exclui em uso local; upload pelo navegador exige conferir manualmente.

## Deploy no Render

1. Crie um Web Service e conecte o repositório GitHub.
2. Runtime: Node.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Configure `NODE_ENV=production`, `SESSION_SECRET` (segredo aleatório forte) e `MONGODB_URI`.
6. O servidor usa `process.env.PORT` e escuta em `0.0.0.0`. O Render fornece HTTPS.
7. Após o deploy, abra a URL, teste `/api/status`, crie uma conta e entre no jogo.
8. Confira os logs do serviço no Render em caso de erro.

## Estrutura

```text
playspace/
├── package.json
├── package-lock.json
├── server.js
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── game.js
├── test/
│   └── server.test.js
├── .env.example
├── .gitignore
└── README.md
```

## Próximas etapas recomendadas

1. Completar testes HTTP/Socket.IO e testes de navegador.
2. Migrar mundo/estado para operações transacionais e controle de proprietário.
3. Tornar movimento, inventário, mineração e construção totalmente autoritativos no servidor.
4. Adicionar crafting, ferramentas, sobrevivência, biomas e conteúdo.
5. Implementar lista de amigos, convites e salas.
6. Testar em Android físico e otimizar com base em medições.
