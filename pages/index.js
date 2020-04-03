import Head from 'next/head';
import Link from 'next/link';
import { useContext, useState } from 'react';
import { GameContext } from './_app';

const App = props => {
  const [gameID, setGameID] = useState('');
  const [isHost, setIsHost] = useState(false);

  const { gameState, setGameState } = useContext(GameContext);
  function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  const hostGameID = getRandomInt(1000, 9999);
  const createGame = () => {
    setIsHost(true);
  };

  return (
    <div className='App'>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1>Pictionary - Covid19 Edition</h1>
        <p style={{ marginBottom: 0 }}>Username</p>
        <input
          style={{ marginBottom: 20 }}
          value={gameState.username}
          onChange={e => {
            const a = e.target.value;
            setGameState(gameState => ({ ...gameState, username: a }));
          }}
        />
        {gameState.username && (
          <>
            <button onClick={() => createGame()}>
              <Link href={`/lobby?host=true&gameID=${hostGameID}`}>
                <a>Create Game</a>
              </Link>
            </button>
            <h4 style={{ marginBottom: 0 }}>Join Game</h4>
            <p style={{ marginBottom: 0, marginTop: 0 }}>Enter Game Code</p>
            <input value={gameID} onChange={e => setGameID(e.target.value)} />
            <Link href={`/lobby?gameID=${gameID}`}>
              <a>Join Game</a>
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
