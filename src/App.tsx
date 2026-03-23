/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update, remove, off, get, onChildAdded } from 'firebase/database';

// --- Constants ---
const SUITS = ['♦', '♥', '♠', '♣'];
const SUIT_NAMES: Record<string, string> = { '♦': 'Ruiton', '♥': 'Harton', '♠': 'Iskapon', '♣': 'Chiriton' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_ORDER: Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12 };
const SUIT_ORDER: Record<string, number> = { '♦': 0, '♥': 1, '♠': 2, '♣': 3 };
const RED_SUITS = ['♦', '♥'];
const WIN_SCORE = 50;

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyAo6OsDxTbUEBZrDW8vGWcYLmBs2E3wPVs",
  authDomain: "card-game-85d02.firebaseapp.com",
  projectId: "card-game-85d02",
  storageBucket: "card-game-85d02.firebasestorage.app",
  messagingSenderId: "646806534267",
  appId: "1:646806534267:web:fccffd1b012e68a7204ade",
  measurementId: "G-7E27GVKCBX",
  databaseURL: "https://card-game-85d02-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Types ---
interface Card {
  suit: string;
  rank: string;
  id: string;
}

interface Player {
  name: string;
  seat: number;
  joinedAt: number;
}

interface GameState {
  phase: string;
  roundNum: number;
  dealerSeat: number;
  currentTurn: number;
  trickLeader: number;
  biddingIdx: number;
  biddingOrder: number[];
  bids: (number | null)[];
  currentHighBid: number;
  highBidder: number;
  trumpSuit: string | null;
  trumpName: string | null;
  matchScores: number[];
  tricks: number[];
  playedCards: (Card | null)[];
  roundHistory: any[];
  teamNames: string[];
  playerNames: string[];
  handCounts: number[];
  ts: number;
}

export default function App() {
  // UI State
  const [screen, setScreen] = useState('menu');
  const [playerName, setPlayerName] = useState('You');
  const [teamAName, setTeamAName] = useState('Team A');
  const [teamBName, setTeamBName] = useState('Team B');
  const [difficulty, setDifficulty] = useState('medium');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [mpPlayerId, setMpPlayerId] = useState<string | null>(null);
  const [mpPlayerSeat, setMpPlayerSeat] = useState(-1);
  const [waitingPlayers, setWaitingPlayers] = useState<Record<string, Player>>({});
  const [toast, setToast] = useState<{ msg: string; show: boolean }>({ msg: '', show: false });
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [bidOverlayOpen, setBidOverlayOpen] = useState(false);
  const [trumpOverlayOpen, setTrumpOverlayOpen] = useState(false);
  const [roundEndOverlayOpen, setRoundEndOverlayOpen] = useState(false);
  const [victoryOpen, setVictoryOpen] = useState(false);
  const [trickResult, setTrickResult] = useState<{ name: string; show: boolean }>({ name: '', show: false });
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedBid, setSelectedBid] = useState<number | null>(null);
  const [selectedTrump, setSelectedTrump] = useState<{ suit: string; name: string } | null>(null);

  // Game Engine State (Authoritative)
  const [G, setG] = useState<GameState>({
    phase: 'idle',
    roundNum: 0,
    dealerSeat: 0,
    currentTurn: -1,
    trickLeader: -1,
    biddingIdx: 0,
    biddingOrder: [],
    bids: [null, null, null, null],
    currentHighBid: 6,
    highBidder: -1,
    trumpSuit: null,
    trumpName: null,
    matchScores: [0, 0],
    tricks: [0, 0, 0, 0],
    playedCards: [null, null, null, null],
    roundHistory: [],
    teamNames: ['Team A', 'Team B'],
    playerNames: ['You', 'P2', 'P3', 'P4'],
    handCounts: [0, 0, 0, 0],
    ts: 0
  });

  const [myHand, setMyHand] = useState<Card[]>([]);
  const [localSeat, setLocalSeat] = useState(0);
  const [mode, setMode] = useState<'ai' | 'multi'>('ai');

  // Refs for logic that needs latest values without re-renders
  const gRef = useRef(G);
  useEffect(() => { gRef.current = G; }, [G]);
  const myHandRef = useRef(myHand);
  useEffect(() => { myHandRef.current = myHand; }, [myHand]);

  // --- Audio ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playSound = (type: string) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      const t = ctx.currentTime;
      const makeNote = (freq: number, start: number, dur: number, vol = 0.18) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur);
        o.start(start); o.stop(start + dur);
      };
      if (type === 'deal') makeNote(660, t, .12, .14);
      else if (type === 'play') makeNote(520, t, .1, .18);
      else if (type === 'win') [523, 659, 784].forEach((f, i) => makeNote(f, t + i * .09, .18, .2));
      else if (type === 'victory') [523, 659, 784, 1047].forEach((f, i) => makeNote(f, t + i * .11, .28, .22));
    } catch (e) { }
  };

  // --- Helpers ---
  const showToast = (msg: string) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2400);
  };

  const genRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  const createDeck = () => {
    const d: Card[] = [];
    SUITS.forEach(s => RANKS.forEach(r => d.push({ suit: s, rank: r, id: r + s })));
    return d;
  };

  const shuffleDeck = (deck: Card[]) => {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  };

  const sortHand = (hand: Card[]) => {
    return [...hand].sort((a, b) => {
      if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
      return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
    });
  };

  const getSeatAtPos = (pos: number) => (localSeat + pos) % 4;
  const getPosOfSeat = (seat: number) => (seat - localSeat + 4) % 4;

  // --- Multiplayer Logic ---
  const pushState = useCallback((newState: GameState, hands: Card[][]) => {
    if (mode !== 'multi' || !isHost || !roomCode) return;
    const roomRef = ref(db, `ruiton_rooms/${roomCode}`);
    update(ref(db, `ruiton_rooms/${roomCode}/gameState`), { ...newState, ts: Date.now() });
    hands.forEach((h, s) => {
      set(ref(db, `ruiton_rooms/${roomCode}/hands/seat${s}`), h || []);
    });
  }, [mode, isHost, roomCode]);

  const writeAction = (type: string, payload: any) => {
    if (mode !== 'multi' || !roomCode) return;
    set(ref(db, `ruiton_rooms/${roomCode}/actions/seat${mpPlayerSeat}`), {
      type, payload, seat: mpPlayerSeat, ts: Date.now()
    });
  };

  // --- AI Logic ---
  const evalHandStrength = (hand: Card[]) => {
    let score = 0;
    const sc: Record<string, number> = {};
    SUITS.forEach(s => sc[s] = 0);
    hand.forEach(c => {
      sc[c.suit]++;
      if (c.rank === 'A') score += 1.5;
      else if (c.rank === 'K') score += 1.2;
      else if (c.rank === 'Q') score += .9;
      else if (c.rank === 'J') score += .65;
      else if (RANK_ORDER[c.rank] >= 7) score += .35;
    });
    Object.values(sc).forEach(n => { if (n >= 5) score += 1.5; else if (n >= 4) score += .7; });
    return Math.round(score);
  };

  const [allHands, setAllHands] = useState<Card[][]>([[], [], [], []]);
  const allHandsRef = useRef(allHands);
  useEffect(() => { allHandsRef.current = allHands; }, [allHands]);

  // --- Game Engine ---
  const startNewRound = useCallback((currentG: GameState) => {
    const deck = shuffleDeck(createDeck());
    const dealer = currentG.dealerSeat;
    const right = (dealer + 3) % 4;
    const biddingOrder = [right, (right + 1) % 4, (right + 2) % 4, (right + 3) % 4];

    const hands: Card[][] = [[], [], [], []];
    // Deal 5 cards each
    for (let i = 0; i < 20; i++) {
      hands[biddingOrder[i % 4]].push(deck.shift()!);
    }

    const nextG: GameState = {
      ...currentG,
      phase: 'bidding',
      roundNum: currentG.roundNum + 1,
      bids: [null, null, null, null],
      currentHighBid: 6,
      highBidder: -1,
      biddingIdx: 0,
      biddingOrder,
      trumpSuit: null,
      trumpName: null,
      trickLeader: -1,
      currentTurn: biddingOrder[0],
      playedCards: [null, null, null, null],
      tricks: [0, 0, 0, 0],
      handCounts: hands.map(h => h.length),
      ts: Date.now()
    };

    setAllHands(hands);
    if (mode === 'ai') {
      setG(nextG);
      setMyHand(sortHand(hands[0]));
    } else if (isHost) {
      setG(nextG);
      setMyHand(sortHand(hands[mpPlayerSeat]));
      pushState(nextG, hands);
    }
  }, [mode, isHost, mpPlayerSeat, pushState]);

  const resolveTrick = useCallback((currentG: GameState, currentHands: Card[][]) => {
    const leadSeat = currentG.trickLeader;
    let winSeat = leadSeat;
    let winCard = currentG.playedCards[leadSeat]!;

    for (let i = 0; i < 4; i++) {
      const card = currentG.playedCards[i];
      if (!card || i === winSeat) continue;
      if (card.suit === currentG.trumpSuit && winCard.suit !== currentG.trumpSuit) {
        winSeat = i; winCard = card;
      } else if (card.suit === winCard.suit && RANK_ORDER[card.rank] > RANK_ORDER[winCard.rank]) {
        winSeat = i; winCard = card;
      }
    }

    const newTricks = [...currentG.tricks];
    newTricks[winSeat]++;
    playSound('win');
    setTrickResult({ name: currentG.playerNames[winSeat], show: true });

    setTimeout(() => {
      setTrickResult(prev => ({ ...prev, show: false }));
      const nextG: GameState = {
        ...currentG,
        tricks: newTricks,
        playedCards: [null, null, null, null],
        trickLeader: winSeat,
        currentTurn: winSeat,
        ts: Date.now()
      };

      if (currentHands[0].length === 0) {
        // End Round
        const tA = newTricks[0] + newTricks[2];
        const tB = newTricks[1] + newTricks[3];
        const bidTeam = (currentG.highBidder === 0 || currentG.highBidder === 2) ? 0 : 1;
        const bid = currentG.currentHighBid;
        const bidTricks = bidTeam === 0 ? tA : tB;
        const defTricks = bidTeam === 0 ? tB : tA;
        const bidWon = bidTricks >= bid;
        const defWon = defTricks >= 5;
        const bidPts = bidWon ? bid : -bid;
        const defPts = defWon ? 5 : -5;

        const newScores = [...currentG.matchScores];
        if (bidTeam === 0) { newScores[0] += bidPts; newScores[1] += defPts; }
        else { newScores[1] += bidPts; newScores[0] += defPts; }

        const history = [...currentG.roundHistory, { round: currentG.roundNum, pA: bidTeam === 0 ? bidPts : defPts, pB: bidTeam === 1 ? bidPts : defPts }];
        
        const finalG = {
          ...nextG,
          phase: 'roundEnd',
          matchScores: newScores,
          roundHistory: history,
          dealerSeat: (currentG.dealerSeat + 1) % 4
        };
        setG(finalG);
        if (mode === 'multi' && isHost) pushState(finalG, currentHands);
        setRoundEndOverlayOpen(true);
      } else {
        setG(nextG);
        if (mode === 'multi' && isHost) pushState(nextG, currentHands);
      }
    }, 1500);
  }, [mode, isHost, pushState]);

  const handlePlayCard = useCallback((seat: number, card: Card) => {
    const currentG = gRef.current;
    
    if (isHost || mode === 'ai') {
      const nextAllHands = [...allHandsRef.current];
      nextAllHands[seat] = nextAllHands[seat].filter(c => c.id !== card.id);
      setAllHands(nextAllHands);
    }

    setG(prev => {
      const nextPlayed = [...prev.playedCards];
      nextPlayed[seat] = card;
      const playedCount = nextPlayed.filter(c => c !== null).length;
      
      const nextG = {
        ...prev,
        playedCards: nextPlayed,
        currentTurn: playedCount === 4 ? -1 : (prev.currentTurn + 1) % 4,
        ts: Date.now()
      };

      if (isHost && mode === 'multi') {
        const nextHandCounts = [...prev.handCounts];
        nextHandCounts[seat]--;
        nextG.handCounts = nextHandCounts;
        pushState(nextG, allHandsRef.current);
      }

      return nextG;
    });

    if (seat === localSeat) {
      setMyHand(prev => prev.filter(c => c.id !== card.id));
    }

    playSound('play');
  }, [localSeat, isHost, mode, pushState]);

  // --- AI Turn Effect ---
  useEffect(() => {
    if (mode !== 'ai' || G.phase === 'idle' || G.phase === 'roundEnd') return;
    const seat = G.currentTurn;
    if (seat === localSeat || seat === -1) return;

    const timer = setTimeout(() => {
      if (G.phase === 'bidding') {
        const strength = evalHandStrength(allHands[seat]);
        const hb = G.currentHighBid;
        let bid = -1;
        if (strength > hb + 1 && strength > 7) bid = Math.min(13, hb + 1);
        
        setG(prev => {
          const nextBids = [...prev.bids];
          nextBids[seat] = bid;
          const nextHigh = bid > prev.currentHighBid ? bid : prev.currentHighBid;
          const nextHighder = bid > prev.currentHighBid ? seat : prev.highBidder;
          const nextIdx = prev.biddingIdx + 1;
          return {
            ...prev,
            bids: nextBids,
            currentHighBid: nextHigh,
            highBidder: nextHighder,
            biddingIdx: nextIdx,
            currentTurn: nextIdx >= 4 ? nextHighder : prev.biddingOrder[nextIdx]
          };
        });
      } else if (G.phase === 'playing') {
        const hand = allHands[seat];
        const leadCard = G.playedCards.find(c => c !== null);
        const leadSuit = leadCard ? leadCard.suit : null;
        let playable = leadSuit ? hand.filter(c => c.suit === leadSuit) : hand;
        if (playable.length === 0) playable = hand;
        const card = playable[Math.floor(Math.random() * playable.length)];
        
        handlePlayCard(seat, card);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [G.currentTurn, G.phase, mode, allHands, handlePlayCard]);

  // --- Trick Resolution Effect ---
  useEffect(() => {
    if (G.playedCards.filter(c => c !== null).length === 4 && G.phase === 'playing') {
      if (mode === 'ai' || isHost) {
        resolveTrick(G, allHands);
      }
    }
  }, [G.playedCards, G.phase, mode, isHost, allHands, resolveTrick]);

  // --- Multiplayer Listeners ---
  useEffect(() => {
    if (mode !== 'multi' || !roomCode) return;

    const roomRef = ref(db, `ruiton_rooms/${roomCode}`);
    const unsubscribe = onValue(roomRef, (snap) => {
      const room = snap.val();
      if (!room) return;

      if (room.players) setWaitingPlayers(room.players);

      if (room.meta && room.meta.status === 'playing' && G.phase === 'idle') {
        // Start Game
        const players = Object.values(room.players as Record<string, Player>);
        const names = [0, 1, 2, 3].map(s => players.find(p => p.seat === s)?.name || `P${s + 1}`);
        setG(prev => ({ ...prev, playerNames: names, phase: 'bidding' }));
        setScreen('game');
        if (isHost) startNewRound({ ...G, playerNames: names });
      }

      if (!isHost && room.gameState) {
        const remoteG = room.gameState;
        if (remoteG.ts > G.ts) {
          setG(remoteG);
          // Sync overlays
          if (remoteG.phase === 'roundEnd') setRoundEndOverlayOpen(true);
          else setRoundEndOverlayOpen(false);
        }
      }

      if (isHost && room.actions) {
        // Process actions
        Object.entries(room.actions).forEach(([key, action]: [string, any]) => {
          if (action.ts > G.ts) {
            const seat = action.seat;
            if (action.type === 'bid' && G.phase === 'bidding' && G.currentTurn === seat) {
              const val = action.payload;
              setG(prev => {
                const nextBids = [...prev.bids];
                nextBids[seat] = val;
                const nextHigh = val > prev.currentHighBid ? val : prev.currentHighBid;
                const nextHighder = val > prev.currentHighBid ? seat : prev.highBidder;
                const nextIdx = prev.biddingIdx + 1;
                const nextG = {
                  ...prev,
                  bids: nextBids,
                  currentHighBid: nextHigh,
                  highBidder: nextHighder,
                  biddingIdx: nextIdx,
                  currentTurn: nextIdx >= 4 ? nextHighder : prev.biddingOrder[nextIdx],
                  ts: Date.now()
                };
                pushState(nextG, allHandsRef.current);
                return nextG;
              });
            } else if (action.type === 'trump' && G.highBidder === seat && !G.trumpSuit) {
              setG(prev => {
                const nextG = { ...prev, trumpSuit: action.payload.suit, trumpName: action.payload.name, phase: 'playing', currentTurn: prev.highBidder, ts: Date.now() };
                pushState(nextG, allHandsRef.current);
                return nextG;
              });
            } else if (action.type === 'playCard' && G.phase === 'playing' && G.currentTurn === seat) {
              const card = action.payload;
              const nextAllHands = [...allHandsRef.current];
              nextAllHands[seat] = nextAllHands[seat].filter(c => c.id !== card.id);
              setAllHands(nextAllHands);

              setG(prev => {
                const nextPlayed = [...prev.playedCards];
                nextPlayed[seat] = card;
                const playedCount = nextPlayed.filter(c => c !== null).length;
                const nextG = {
                  ...prev,
                  playedCards: nextPlayed,
                  currentTurn: playedCount === 4 ? -1 : (prev.currentTurn + 1) % 4,
                  ts: Date.now()
                };
                const nextHandCounts = [...prev.handCounts];
                nextHandCounts[seat]--;
                nextG.handCounts = nextHandCounts;
                
                pushState(nextG, nextAllHands);
                return nextG;
              });
            }
          }
        });
      }
    });

    return () => off(roomRef);
  }, [mode, roomCode, isHost, G.ts]);

  // --- Hand Listener for Multi ---
  useEffect(() => {
    if (mode !== 'multi' || !roomCode || mpPlayerSeat === -1) return;
    const handRef = ref(db, `ruiton_rooms/${roomCode}/hands/seat${mpPlayerSeat}`);
    onValue(handRef, (snap) => {
      const hand = snap.val();
      if (hand) setMyHand(sortHand(hand));
    });
    return () => off(handRef);
  }, [mode, roomCode, mpPlayerSeat]);

  // --- UI Handlers ---
  const startAIGame = () => {
    setMode('ai');
    setLocalSeat(0);
    const names = [playerName, 'Aida', 'Bilal', 'Cara'];
    const initialG = { ...G, playerNames: names, teamNames: [teamAName, teamBName] };
    setG(initialG);
    setScreen('game');
    startNewRound(initialG);
  };

  const createRoom = async () => {
    const code = genRoomCode();
    const pid = 'p_' + Date.now();
    setMpPlayerId(pid);
    setMpPlayerSeat(0);
    setRoomCode(code);
    setIsHost(true);
    setLocalSeat(0);
    setMode('multi');

    await set(ref(db, `ruiton_rooms/${code}`), {
      meta: { host: pid, status: 'waiting', createdAt: Date.now(), code },
      players: { [pid]: { name: playerName, seat: 0, joinedAt: Date.now() } }
    });
    setScreen('waiting');
  };

  const joinRoom = async () => {
    const code = joinCode.toUpperCase();
    const snap = await get(ref(db, `ruiton_rooms/${code}`));
    const room = snap.val();
    if (!room) { showToast('Room not found'); return; }
    
    const players = room.players || {};
    const takenSeats = Object.values(players as Record<string, Player>).map(p => p.seat);
    const nextSeat = [0, 1, 2, 3].find(s => !takenSeats.includes(s));
    if (nextSeat === undefined) { showToast('Room is full'); return; }

    const pid = 'p_' + Date.now();
    setMpPlayerId(pid);
    setMpPlayerSeat(nextSeat);
    setRoomCode(code);
    setIsHost(false);
    setLocalSeat(nextSeat);
    setMode('multi');

    await update(ref(db, `ruiton_rooms/${code}/players/${pid}`), { name: playerName, seat: nextSeat, joinedAt: Date.now() });
    setScreen('waiting');
  };

  const hostStartGame = async () => {
    await update(ref(db, `ruiton_rooms/${roomCode}/meta`), { status: 'playing' });
  };

  const handleBid = (val: number) => {
    if (mode === 'multi' && !isHost) {
      writeAction('bid', val);
    } else {
      setG(prev => {
        const nextBids = [...prev.bids];
        nextBids[localSeat] = val;
        const nextHigh = val > prev.currentHighBid ? val : prev.currentHighBid;
        const nextHighder = val > prev.currentHighBid ? localSeat : prev.highBidder;
        const nextIdx = prev.biddingIdx + 1;
        return {
          ...prev,
          bids: nextBids,
          currentHighBid: nextHigh,
          highBidder: nextHighder,
          biddingIdx: nextIdx,
          currentTurn: nextIdx >= 4 ? nextHighder : prev.biddingOrder[nextIdx]
        };
      });
    }
    setBidOverlayOpen(false);
  };

  const handleTrump = (suit: string, name: string) => {
    if (mode === 'multi' && !isHost) {
      writeAction('trump', { suit, name });
    } else {
      setG(prev => ({ ...prev, trumpSuit: suit, trumpName: name, phase: 'playing', currentTurn: prev.highBidder }));
    }
    setTrumpOverlayOpen(false);
  };

  const playCard = (card: Card) => {
    if (G.currentTurn !== localSeat) return;
    const leadCard = G.playedCards.find(c => c !== null);
    if (leadCard && card.suit !== leadCard.suit && myHand.some(c => c.suit === leadCard.suit)) {
      showToast('Must follow suit!');
      return;
    }

    if (mode === 'multi' && !isHost) {
      writeAction('playCard', card);
    } else {
      handlePlayCard(localSeat, card);
    }
    setSelectedCard(null);
  };

  // --- Render Helpers ---
  const renderCard = (card: Card, playable = false) => {
    const isRed = RED_SUITS.includes(card.suit);
    const isSelected = selectedCard?.id === card.id;
    return (
      <div 
        key={card.id}
        className={`card ${isRed ? 'red' : 'black'} ${playable ? 'playable' : ''} ${isSelected ? 'selected' : ''}`}
        onClick={() => playable && setSelectedCard(isSelected ? null : card)}
      >
        <div className="card-top">
          <div className="card-rank">{card.rank}</div>
          <div className="card-suit-sm">{card.suit}</div>
        </div>
        <div className="card-center">{card.suit}</div>
        <div className="card-bottom">
          <div className="card-rank">{card.rank}</div>
          <div className="card-suit-sm">{card.suit}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      {/* --- Menu Screen --- */}
      {screen === 'menu' && (
        <div id="menuScreen" className="screen">
          <div className="menu-bg-pattern"></div>
          <div className="menu-logo">
            <div className="menu-suits"><span>♦</span><span>♣</span><span>♠</span><span>♥</span></div>
            <h1>RUITON</h1>
            <div className="subtitle">A Partnership Trick-Taking Game</div>
          </div>
          <div className="menu-panel">
            <button className="menu-btn primary" onClick={() => setScreen('aiConfig')}>
              <span className="btn-icon">🤖</span><span className="btn-text">AI Match</span><span>›</span>
            </button>
            <button className="menu-btn secondary" onClick={() => setScreen('multiConfig')}>
              <span className="btn-icon">👥</span><span className="btn-text">Friendly Multiplayer</span><span>›</span>
            </button>
            <div className="menu-divider"></div>
            <div className="menu-footer">
              <button className="icon-btn" onClick={() => setScoreboardOpen(true)}>📊</button>
            </div>
          </div>
        </div>
      )}

      {/* --- AI Config --- */}
      {screen === 'aiConfig' && (
        <div className="screen">
          <div className="mode-panel">
            <button className="back-btn" onClick={() => setScreen('menu')}>← Back</button>
            <h2>AI Match</h2>
            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input className="form-input" value={playerName} onChange={e => setPlayerName(e.target.value)} maxLength={14} />
            </div>
            <div className="form-group">
              <label className="form-label">Team Names</label>
              <div className="grid grid-cols-2 gap-2">
                <input className="form-input" value={teamAName} onChange={e => setTeamAName(e.target.value)} placeholder="Team A" />
                <input className="form-input" value={teamBName} onChange={e => setTeamBName(e.target.value)} placeholder="Team B" />
              </div>
            </div>
            <button className="menu-btn primary" onClick={startAIGame}>Start Game</button>
          </div>
        </div>
      )}

      {/* --- Multi Config --- */}
      {screen === 'multiConfig' && (
        <div className="screen">
          <div className="mode-panel">
            <button className="back-btn" onClick={() => setScreen('menu')}>← Back</button>
            <h2>Multiplayer</h2>
            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input className="form-input" value={playerName} onChange={e => setPlayerName(e.target.value)} maxLength={14} />
            </div>
            <button className="menu-btn primary" onClick={createRoom}>Create Room</button>
            <div className="menu-divider"></div>
            <div className="form-group">
              <input className="form-input" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Room Code" maxLength={5} />
            </div>
            <button className="menu-btn secondary" onClick={joinRoom}>Join Room</button>
          </div>
        </div>
      )}

      {/* --- Waiting Room --- */}
      {screen === 'waiting' && (
        <div className="screen">
          <div className="mode-panel">
            <h2>Waiting Room</h2>
            <div className="room-code-display">
              <div className="code-label">Room Code</div>
              <div className="code-value">{roomCode}</div>
            </div>
            <div className="waiting-players">
              {[0, 1, 2, 3].map(s => {
                const p = (Object.values(waitingPlayers) as any[]).find(x => x.seat === s);
                return (
                  <div key={s} className={`waiting-player-slot ${p ? 'filled' : ''}`}>
                    <div className="slot-num">{s + 1}</div>
                    <div className="slot-name">{p ? p.name : 'Waiting...'}</div>
                  </div>
                );
              })}
            </div>
            {isHost && Object.keys(waitingPlayers).length >= 2 && (
              <button className="menu-btn primary" onClick={hostStartGame}>Start Game</button>
            )}
            <button className="menu-btn secondary" onClick={() => setScreen('menu')}>Leave</button>
          </div>
        </div>
      )}

      {/* --- Game Screen --- */}
      {screen === 'game' && (
        <div className="screen !items-stretch !justify-stretch bg-none">
          <div className="game-header">
            <div className="game-header-title">RUITON</div>
            <div className="score-pills">
              <div className="score-pill team-a">{G.teamNames[0]}: {G.matchScores[0]}</div>
              <div className="score-pill team-b">{G.teamNames[1]}: {G.matchScores[1]}</div>
            </div>
            <div className="flex gap-2">
              <button className="icon-btn" onClick={() => setScoreboardOpen(true)}>📊</button>
              <button className="icon-btn" onClick={() => setGameMenuOpen(true)}>☰</button>
            </div>
          </div>

          <div className="game-table">
            {/* Top */}
            <div className="player-area-top">
              <div className={`player-badge badge-tb ${G.currentTurn === getSeatAtPos(2) ? 'active-turn' : ''}`}>
                <span className="badge-name">{G.playerNames[getSeatAtPos(2)]}</span>
                <span className="badge-tricks">{G.tricks[getSeatAtPos(2)]}</span>
              </div>
              <div className="hand-top">
                {new Array(G.handCounts[getSeatAtPos(2)]).fill(0).map((_, i) => (
                  <div key={i} className="card-back" style={{ marginLeft: i === 0 ? 0 : -30 }}></div>
                ))}
              </div>
            </div>

            {/* Left */}
            <div className="player-area-left">
              <div className={`player-badge badge-tb ${G.currentTurn === getSeatAtPos(3) ? 'active-turn' : ''}`}>
                <span className="badge-name">{G.playerNames[getSeatAtPos(3)]}</span>
                <span className="badge-tricks">{G.tricks[getSeatAtPos(3)]}</span>
              </div>
              <div className="side-hand-visual">
                <div className="side-card-back"></div>
                <span className="side-card-count">{G.handCounts[getSeatAtPos(3)]}</span>
              </div>
            </div>

            {/* Center */}
            <div className="table-center">
              <div className="center-info">
                {G.trumpSuit && (
                  <div className="trump-pill">
                    <span className="tp-suit" style={{ color: RED_SUITS.includes(G.trumpSuit) ? '#c0392b' : '#faf3e0' }}>{G.trumpSuit}</span>
                    <span className="tp-name">{G.trumpName}</span>
                  </div>
                )}
                {G.highBidder !== -1 && (
                  <div className="bid-pill">
                    <span className="bp-val">{G.currentHighBid}</span>
                    <span className="bp-team">{G.teamNames[(G.highBidder === 0 || G.highBidder === 2) ? 0 : 1]}</span>
                  </div>
                )}
              </div>

              <div className="trick-zone">
                <div className="trick-slot trick-slot-bottom">{G.playedCards[localSeat] && renderCard(G.playedCards[localSeat]!)}</div>
                <div className="trick-slot trick-slot-right">{G.playedCards[getSeatAtPos(1)] && renderCard(G.playedCards[getSeatAtPos(1)]!)}</div>
                <div className="trick-slot trick-slot-top">{G.playedCards[getSeatAtPos(2)] && renderCard(G.playedCards[getSeatAtPos(2)]!)}</div>
                <div className="trick-slot trick-slot-left">{G.playedCards[getSeatAtPos(3)] && renderCard(G.playedCards[getSeatAtPos(3)]!)}</div>
              </div>
            </div>

            {/* Right */}
            <div className="player-area-right">
              <div className={`player-badge badge-ta ${G.currentTurn === getSeatAtPos(1) ? 'active-turn' : ''}`}>
                <span className="badge-name">{G.playerNames[getSeatAtPos(1)]}</span>
                <span className="badge-tricks">{G.tricks[getSeatAtPos(1)]}</span>
              </div>
              <div className="side-hand-visual">
                <div className="side-card-back"></div>
                <span className="side-card-count">{G.handCounts[getSeatAtPos(1)]}</span>
              </div>
            </div>

            {/* Bottom */}
            <div className="player-area-bottom">
              <div className="hand-bottom">
                {myHand.map((c, i) => (
                  <div key={c.id} style={{ marginLeft: i === 0 ? 0 : -35 }}>
                    {renderCard(c, G.currentTurn === localSeat)}
                  </div>
                ))}
              </div>
              <div className={`player-badge badge-ta ${G.currentTurn === localSeat ? 'active-turn' : ''}`}>
                <span className="badge-name">{playerName}</span>
                <span className="badge-tricks">{G.tricks[localSeat]}</span>
              </div>
            </div>
          </div>

          <div className="action-bar">
            {G.phase === 'bidding' && G.currentTurn === localSeat && (
              <button className="action-btn gold" onClick={() => setBidOverlayOpen(true)}>Place Bid</button>
            )}
            {G.phase === 'playing' && G.currentTurn === localSeat && (
              <button className="action-btn gold" disabled={!selectedCard} onClick={() => selectedCard && playCard(selectedCard)}>Play Card</button>
            )}
            <span className="action-msg">
              {G.currentTurn === localSeat ? 'Your Turn' : `Waiting for ${G.playerNames[G.currentTurn] || '...'}`}
            </span>
          </div>
        </div>
      )}

      {/* --- Overlays --- */}
      {bidOverlayOpen && (
        <div className="overlay">
          <div className="modal">
            <h3>Place Your Bid</h3>
            <div className="bid-grid">
              {[7, 8, 9, 10, 11, 12, 13].map(b => (
                <button 
                  key={b} 
                  className={`bid-option ${selectedBid === b ? 'active' : ''} ${b <= G.currentHighBid ? 'opacity-30 pointer-events-none' : ''}`}
                  onClick={() => setSelectedBid(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            <button className="action-btn gold w-full mb-2" onClick={() => selectedBid && handleBid(selectedBid)}>Confirm</button>
            <button className="action-btn outline w-full" onClick={() => handleBid(-1)}>Pass</button>
          </div>
        </div>
      )}

      {trumpOverlayOpen || (G.phase === 'bidding' && G.biddingIdx >= 4 && G.highBidder === localSeat && !G.trumpSuit) && (
        <div className="overlay">
          <div className="modal">
            <h3>Select Trump</h3>
            <div className="trump-grid">
              {SUITS.map(s => (
                <button 
                  key={s} 
                  className={`trump-option ${selectedTrump?.suit === s ? 'active' : ''}`}
                  onClick={() => setSelectedTrump({ suit: s, name: SUIT_NAMES[s] })}
                >
                  <span className="suit-icon" style={{ color: RED_SUITS.includes(s) ? '#c0392b' : '#faf3e0' }}>{s}</span>
                  <span className="suit-name">{SUIT_NAMES[s]}</span>
                </button>
              ))}
            </div>
            <button className="action-btn gold w-full" onClick={() => selectedTrump && handleTrump(selectedTrump.suit, selectedTrump.name)}>Confirm</button>
          </div>
        </div>
      )}

      {gameMenuOpen && (
        <div className="overlay">
          <div className="modal">
            <h3>Menu</h3>
            <button className="menu-btn secondary mb-2" onClick={() => { setGameMenuOpen(false); startNewRound({ ...G, matchScores: [0, 0], roundNum: 0, roundHistory: [] }); }}>Restart Match</button>
            <button className="menu-btn secondary mb-2" onClick={() => { setGameMenuOpen(false); setScreen('menu'); }}>Main Menu</button>
            <button className="back-btn w-full justify-center" onClick={() => setGameMenuOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {scoreboardOpen && (
        <div className="overlay">
          <div className="modal max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="m-0">Scoreboard</h3>
              <button className="icon-btn" onClick={() => setScoreboardOpen(false)}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="total-score-card tsc-a">
                <div className="tsc-team">{G.teamNames[0]}</div>
                <div className="tsc-val">{G.matchScores[0]}</div>
              </div>
              <div className="total-score-card tsc-b">
                <div className="tsc-team">{G.teamNames[1]}</div>
                <div className="tsc-val">{G.matchScores[1]}</div>
              </div>
            </div>
            <div className="space-y-2">
              {G.roundHistory.slice().reverse().map((h, i) => (
                <div key={i} className="history-item">
                  <div className="rnd-label">Round {h.round}</div>
                  <div className="flex justify-between">
                    <span>{G.teamNames[0]}</span>
                    <span className={h.pA >= 0 ? 'text-green-400' : 'text-red-400'}>{h.pA >= 0 ? '+' : ''}{h.pA}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{G.teamNames[1]}</span>
                    <span className={h.pB >= 0 ? 'text-green-400' : 'text-red-400'}>{h.pB >= 0 ? '+' : ''}{h.pB}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {roundEndOverlayOpen && (
        <div className="overlay">
          <div className="modal">
            <h3>Round Results</h3>
            <table className="score-table">
              <thead><tr><th>Team</th><th>Tricks</th><th>Points</th></tr></thead>
              <tbody>
                <tr><td>{G.teamNames[0]}</td><td>{G.tricks[0] + G.tricks[2]}</td><td>{G.roundHistory[G.roundHistory.length - 1]?.pA}</td></tr>
                <tr><td>{G.teamNames[1]}</td><td>{G.tricks[1] + G.tricks[3]}</td><td>{G.roundHistory[G.roundHistory.length - 1]?.pB}</td></tr>
              </tbody>
            </table>
            <button className="action-btn gold w-full" onClick={() => { setRoundEndOverlayOpen(false); startNewRound(G); }}>Next Round</button>
          </div>
        </div>
      )}

      {trickResult.show && (
        <div className="trick-result show">
          <div className="tr-name">{trickResult.name}</div>
          <div className="tr-sub">Wins the trick!</div>
        </div>
      )}

      {toast.show && <div className="toast show">{toast.msg}</div>}
    </div>
  );
}
