import { assign } from '@xstate/immer';
import { actions, Machine, send, sendParent } from 'xstate';
import wordList from '../data/medium1';
import { pusher } from '../pages/_app';

const { log } = actions;

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ClientMachine = Machine({
  id: 'client',
  initial: 'idle',
  context: {
    gameID: undefined,
    pusher,
  },
  states: {
    idle: {
      on: {
        CONNECT_TO_GAME: {
          target: 'connected',
          actions: assign((ctx, event) => (ctx.gameID = event.gameID)),
        },
      },
    },
    connected: {
      invoke: {
        id: 'socket',
        src: (ctx, event) => (callback, onEvent) => {
          console.log('INVOKE GAME SOCKET', ctx.gameID);
          const channel = pusher.subscribe(`${ctx.gameID}-host-events`);
          channel.bind('events', async (event) => {
            console.log('GAME ', event);
            if (Array.isArray(event)) {
              event.forEach((event) => {
                callback({ type: 'TO_PARENT', event });
              });
            } else {
              callback({ type: 'TO_PARENT', event });
            }
          });

          onEvent(async (event) => {
            console.log('BROADCAST', event);
            const res = await fetch('/api/game', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ...event, gameID: ctx.gameID }),
            });
            if (!res.ok) {
              console.error('event not sent');
            }
          });

          return () => pusher.unsubscribe(`${ctx.gameID}-host-events`);
        },
      },
      on: {
        // events from websocket to the game machine
        TO_PARENT: {
          actions: [
            sendParent((ctx, event) => {
              console.log('sent to machine, ', event, event.event);
              return event.event;
            }),
          ],
        },
        // events from the game machine to the websocket
        '*': {
          actions: send(
            (ctx, event) => {
              console.log('SEND TO PLAYER', event);
              return {
                ...event,
              };
            },
            { to: 'socket' }
          ),
        },
      },
    },
  },
});

const GameMachine = Machine(
  {
    id: 'game',
    initial: 'ready',
    context: {
      gameID: undefined,
      game: {
        players: {},
        teams: {},
      },
      play: {
        currentPlayer: undefined,
        currentTeam: undefined,
        team1: {
          members: [],
          points: 0,
          lastPlayed: undefined,
        },
        team2: {
          members: [],
          points: 0,
          lastPlayed: undefined,
        },
      },
      pusher,
      playerRefs: [],
    },
    invoke: {
      id: 'client',
      src: ClientMachine,
    },
    states: {
      ready: {
        on: {
          CREATE_GAME: {
            target: 'lobby',
            actions: [
              'generateGameID',
              send((ctx, event) => ({ type: 'CONNECT_TO_GAME', gameID: event.gameID }), { to: 'client' }),
              (ctx, event) => {
                event.callback();
              },
            ],
          },
        },
      },
      lobby: {
        on: {
          START_GAME: {
            target: 'inGame',
            actions: ['broadcastStartGame', 'derivePlayState'],
            cond: 'playersFromBothTeams',
          },
          CHANGE_TEAM: {
            actions: ['changeTeam', 'broadcastGameState'],
          },
          PLAYER_JOIN: {
            actions: [log(), 'joinGame', 'broadcastGameState'],
          },
        },
      },
      inGame: {
        initial: 'beforeTurn',
        states: {
          beforeTurn: {
            entry: [
              'broadcastBeforeTurn',
              log((context, event) => `count: ${context}, event: ${event}`, 'Finish label'),
              'broadcastPoints',
            ],
            on: {
              START_TURN: {
                target: 'preTurn',
                actions: ['log', 'assignWord', 'setTeam', 'assignNextPlayer', 'broadcastPlayState', 'broadcastPreTurn'],
              },
            },
          },
          preTurn: {
            // entry: ['setTeam', 'assignNextPlayer', 'broadcastPlayState', 'broadcastPreTurn'],
            after: {
              15000: 'playing',
            },
          },
          playing: {
            entry: ['broadcastTurn'],
            after: {
              60000: 'endOfTurn',
            },
          },
          endOfTurn: {
            entry: ['broadcastEndOfTurn'],
            on: {
              SUCCESSFUL: {
                target: 'beforeTurn',
                actions: ['cleanupTurn', 'tallyPointsSuccess'],
              },
              UNSUCCESSFUL: {
                target: 'beforeTurn',
                actions: ['cleanupTurn'],
              },
            },
          },
        },
      },
    },
  },
  {
    actions: {
      tallyPointsSuccess: assign((ctx, event) => {
        const currentTeamInfo = ctx.play[ctx.play.currentTeam];
        const newCurrentTeamInfo = { ...currentTeamInfo, points: currentTeamInfo.points + 1 };
        ctx.play[ctx.play.currentTeam] = newCurrentTeamInfo;
      }),
      log: (ctx, event) => console.log(event),
      assignWord: assign((ctx, event) => (ctx.play.word = wordList[Math.floor(Math.random() * wordList.length)])),
      broadcastPoints: send(
        (ctx, event) => {
          console.log(ctx);
          return { type: 'POINTS_UPDATE', team1: ctx.play.team1.points, team2: ctx.play.team2.points };
        },
        { to: 'client' }
      ),
      assignNextPlayer: assign((ctx, event) => {
        const { members, lastPlayed } = ctx.play[ctx.play.currentTeam];
        const lastPlayedIndex = members.indexOf(lastPlayed);
        const nextPlayerIndex = lastPlayedIndex + 1 >= members.length ? 0 : lastPlayedIndex + 1;
        const nextPlayer = members[nextPlayerIndex];
        ctx.play.currentPlayer = nextPlayer;
      }),
      setTeam: assign((ctx, event) => {
        console.log('START TURN');
        ctx.play.currentTeam = ctx.play.currentTeam && ctx.play.currentTeam === 'team1' ? 'team2' : 'team1';
      }),
      cleanupTurn: assign((ctx, event) => {
        const { currentTeam, currentPlayer } = ctx.play;
        ctx.play[currentTeam].lastPlayed = currentPlayer;
      }),
      broadcastBeforeTurn: send('BEFORE_TURN', { to: 'client' }),
      broadcastPreTurn: send('PRE_TURN', { to: 'client' }),
      broadcastTurn: send('TURN', { to: 'client' }),
      broadcastEndOfTurn: send('END_OF_TURN', { to: 'client' }),
      broadcastPlayState: send(
        (ctx, event) => {
          const { currentPlayer, team1, team2, currentTeam, word } = ctx.play;
          const playerDrawing = ctx.game.players[currentPlayer].username;
          const playerEvents = {};
          playerEvents[currentPlayer] = {
            type: 'DRAW',
            word,
          };

          const currentTeamData = currentTeam === 'team2' ? team2 : team1;
          const otherTeamData = currentTeam === 'team2' ? team1 : team2;
          console.log(currentTeam, currentTeamData, otherTeamData);
          currentTeamData.members.forEach((member) => {
            if (member !== currentPlayer) {
              playerEvents[member] = {
                type: 'GUESS',
                playerDrawing: playerDrawing,
              };
            }
          });

          otherTeamData.members.forEach((member) => {
            if (member !== currentPlayer) {
              playerEvents[member] = {
                type: 'SPECTATE',
                playerDrawing: playerDrawing,
                word,
              };
            }
          });
          console.log('PLAYER EVENTS', playerEvents);
          return { type: 'TEAM_1_TURN', gameID: ctx.gameID, playerEvents };
        },
        { to: 'client' }
      ),
      broadcastGameState: send(
        (ctx, event) => ({
          type: 'GAME_UPDATE',
          gameID: ctx.gameID,
          game: ctx.game,
        }),
        { to: 'client' }
      ),
      broadcastStartGame: send(
        (ctx, event) => ({
          type: 'START_GAME',
          gameID: ctx.gameID,
          game: ctx.game,
        }),
        { to: 'client' }
      ),
      derivePlayState: assign((ctx, event) => {
        ctx.play = {
          team1: {
            members: Object.keys(ctx.game.teams).filter((userID) => ctx.game.teams[userID] === 'Team 1'),
            lastPlayed: undefined,
            points: 0,
          },
          team2: {
            members: Object.keys(ctx.game.teams).filter((userID) => ctx.game.teams[userID] === 'Team 2'),
            lastPlayed: undefined,
            points: 0,
          },
        };
      }),
      generateGameID: assign((ctx, event) => (ctx.gameID = event.gameID)),
      changeTeam: assign((ctx, event) => (ctx.game.teams[event.userID] = event.team)),
      joinGame: assign((ctx, event) => {
        ctx.game.players[event.userID] = { username: event.username };
      }),
    },
    guards: {
      playersFromBothTeams: (ctx, event) => {
        let team1 = false;
        let team2 = false;
        Object.values(ctx.game.teams).forEach((team) => {
          if (team === 'Team 1') {
            team1 = true;
          }

          if (team === 'Team 2') {
            team2 = true;
          }
        });
        return team1 && team2;
      },
    },
  }
);

export default GameMachine;
