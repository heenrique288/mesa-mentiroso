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

## Jogando pela internet

O jeito mais simples, sem configurar nada no roteador, é abrir um túnel para a sua porta
3000 e mandar o link gerado para a galera:

```bash
npx localtunnel --port 3000
# ou, se tiver o Cloudflare Tunnel:  cloudflared tunnel --url http://localhost:3000
```

Para hospedar de verdade, qualquer serviço que rode Node com WebSocket serve (Render,
Railway, Fly.io). O servidor respeita a variável de ambiente `PORT`.

## Ajustes rápidos

| O quê | Onde |
|---|---|
| Composição do baralho | `DECK_COMPOSITION` em `server/game.js` |
| Cartas na mão / número de câmaras | `HAND_SIZE` e `CHAMBERS` em `server/game.js` |
| Ritmo (tempo de revelação, gatilho automático, intervalo entre rodadas) | constantes no topo de `server/room.js` |
| Agressividade dos bots | `suspicionLevel` em `server/bot.js` |
| Enquadramento da câmera | `cameraBase` e `SEAT_RADIUS` em `public/js/world.js` |
