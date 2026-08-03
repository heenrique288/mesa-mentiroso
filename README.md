# 🃏 Mesa do Mentiroso

Jogo web multiplayer inspirado no *Liar's Bar*: mesa 3D em primeira pessoa, blefe puro e
roleta russa para quem for pego. Feito para jogar com os amigos pelo navegador.

## Como rodar

```bash
npm install
npm start
```

O terminal mostra dois endereços:

```
Neste computador:  http://localhost:3000
Na sua rede:       http://192.168.1.2:3000
```

Abra o primeiro no seu navegador. Seus amigos, **na mesma rede (Wi-Fi de casa)**, abrem o
segundo. Você cria a sala, manda o código de 4 letras no grupo, e todo mundo entra.

> Para jogar com quem está longe, veja [Jogando pela internet](#jogando-pela-internet).

## Como se joga

- O baralho tem **só Ases, Reis, Damas e Coringas**:
  - **4 jogadores** → 20 cartas (6 Reis, 6 Damas, 6 Ases, 2 Coringas)
  - **6 jogadores** → 30 cartas (9 Reis, 9 Damas, 9 Ases, 3 Coringas)
  - O baralho inteiro é distribuído: 5 cartas para cada um.
- Toda rodada tem um **Tema da Mesa** sorteado (Rodada do Rei, da Dama ou do Ás).
- Na sua vez você baixa de **1 a 5 cartas viradas para baixo**, afirmando que são todas do
  tema. Você pode mentir à vontade — ninguém vê o que desceu.
- **Só o jogador seguinte** (no sentido horário) pode reagir, e tem duas opções:
  - **Gritar MENTIROSO** e virar as cartas do anterior; ou
  - **Baixar as próprias cartas**, deixando a dúvida passar adiante para o próximo.
- No desafio as cartas são reveladas:
  - Se tinha qualquer carta fora do tema → **o mentiroso paga**.
  - Se era tudo verdade → **o acusador paga**.
  - **Coringa vale como qualquer carta** e nunca conta como mentira.
- Quem paga aponta o revólver para si e puxa o gatilho. Cada jogador tem o **seu próprio
  revólver: 6 câmaras, 1 bala**, em posição sorteada e secreta. A câmara avança a cada
  punição — quanto mais você perde, maior a chance.
- Quem toma a bala é eliminado. **Ganha quem sobrar por último.**

### Detalhes de regra implementados

- Quem fica sem cartas é **pulado** nas jogadas seguintes até o fim da rodada.
- Se todos ficarem sem cartas sem ninguém desafiar, a rodada é **anulada** (ninguém atira)
  e um novo baralho é distribuído.
- Depois de um tiro, **quem sobreviveu à punição abre a rodada seguinte**.

## Recursos

- **Multiplayer real por salas** — código de 4 letras, quantos grupos quiser ao mesmo tempo.
- **Servidor autoritativo** — a mão dos adversários e o conteúdo do monte nunca são enviados
  ao seu navegador, então não dá para trapacear pelo console.
- **Bots** para completar a mesa e testar sozinho (botão *+ Adicionar bot* no lobby).
- **Reconexão** — se você atualizar a página ou cair, volta para o mesmo assento. Enquanto
  isso, a casa joga por você em piloto automático para a partida não travar.
- **Visão em primeira pessoa** com Three.js: mesa redonda, luz de bar, avatares (Urso,
  Touro, Raposa, Coelho, Corvo, Sapo), cartas físicas caindo no feltro e animação de
  revelação no desafio.
- **Sem nenhum asset externo** — texturas e sons são gerados em canvas e WebAudio, e o
  Three.js é servido do próprio `node_modules`. Funciona offline na sua rede.
- Histórico de jogadas, chat da mesa e HUD com as câmaras já gastas de cada jogador.

## Estrutura

```
server/
  game.js    Motor de regras (baralho, turnos, desafio, roleta). Puro, sem rede.
  bot.js     Heurística dos bots: quando blefar e quando desconfiar.
  room.js    Sala: assentos, temporizadores, piloto automático, transmissão de estado.
  index.js   HTTP + Socket.IO.
public/
  index.html Telas (início, lobby, jogo) e sobreposições.
  css/       Tema do bar.
  js/
    main.js      Controlador: telas, rede e coreografia dos eventos.
    world.js     Cena 3D, câmera em primeira pessoa e animação das cartas.
    avatars.js   Personagens montados com formas primitivas.
    textures.js  Cartas, madeira e placas geradas em canvas.
    ui.js        Renderização do DOM (mão, painéis, overlays).
    audio.js     Efeitos sonoros sintetizados.
```

## Publicando na internet

O jogo precisa de um servidor Node rodando **com WebSocket** — não dá para hospedar em
lugares de site estático (GitHub Pages, Netlify Drop). Duas receitas:

### A) Agora, sem criar conta (link temporário)

Deixe `npm start` rodando e, em outro terminal, abra um túnel para a sua porta 3000:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Ele imprime um endereço `https://algo-aleatorio.trycloudflare.com`. Mande esse link para a
galera e pronto. O link vive enquanto o comando e o seu PC estiverem ligados.

> Alternativa: `npx localtunnel --port 3000` (pede uma senha na primeira visita, que é o
> IP público mostrado por `curl https://loca.lt/mytunnelpassword`).

### B) Link permanente (Render, plano gratuito)

O repositório já vem com [`render.yaml`](render.yaml), então o Render se configura sozinho.

1. Suba o código para o GitHub (repositório **privado** já serve):
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/mesa-do-mentiroso.git
   git push -u origin main
   ```
2. Em [render.com](https://render.com), entre com a conta do GitHub.
3. **New +** → **Blueprint** → escolha o repositório → **Apply**.
4. Em ~2 minutos sai a URL: `https://mesa-do-mentiroso.onrender.com`. É esse link que você
   manda no grupo.

A cada `git push` o Render publica a nova versão sozinho.

**O que esperar do plano gratuito:** a instância dorme após ~15 minutos sem ninguém
acessando, e a primeira visita depois disso demora ~50 segundos para responder. Enquanto
dorme, **as salas abertas são perdidas** (o estado das partidas fica na memória). Combine
de todo mundo entrar junto, ou peça para alguém abrir o link uns minutos antes. Para
evitar o modo ocioso, aponte um monitor gratuito (UptimeRobot, cron-job.org) para
`https://sua-url.onrender.com/healthz` a cada 10 minutos.

Railway, Fly.io e Koyeb funcionam igual — todos leem o `npm start` e a variável `PORT`.

## Ajustes rápidos

| O quê | Onde |
|---|---|
| Composição do baralho | `DECK_COMPOSITION` em `server/game.js` |
| Cartas na mão / número de câmaras | `HAND_SIZE` e `CHAMBERS` em `server/game.js` |
| Ritmo (tempo de revelação, gatilho automático, intervalo entre rodadas) | constantes no topo de `server/room.js` |
| Agressividade dos bots | `suspicionLevel` em `server/bot.js` |
| Enquadramento da câmera | `cameraBase` e `SEAT_RADIUS` em `public/js/world.js` |
