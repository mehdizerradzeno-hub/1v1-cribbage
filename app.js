(() => {
  "use strict";

  const SUITS = [
    { symbol: "♣", name: "clubs", color: "black" },
    { symbol: "♦", name: "diamonds", color: "red" },
    { symbol: "♥", name: "hearts", color: "red" },
    { symbol: "♠", name: "spades", color: "black" },
  ];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, Math.min(index + 1, 10)]));
  const RANK_ORDER = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 1]));
  const TARGET_SCORE = 121;

  const ui = {
    playerScore: document.querySelector("#player-score"),
    botScore: document.querySelector("#bot-score"),
    playerPeg: document.querySelector("#player-peg"),
    botPeg: document.querySelector("#bot-peg"),
    handLabel: document.querySelector("#hand-label"),
    dealerLabel: document.querySelector("#dealer-label"),
    phaseTitle: document.querySelector("#phase-title"),
    turnChip: document.querySelector("#turn-chip"),
    playerHand: document.querySelector("#player-hand"),
    botHand: document.querySelector("#bot-hand"),
    botCardCount: document.querySelector("#bot-card-count"),
    selectionCount: document.querySelector("#selection-count"),
    cribCards: document.querySelector("#crib-cards"),
    cribOwner: document.querySelector("#crib-owner"),
    peggingCards: document.querySelector("#pegging-cards"),
    runningTotal: document.querySelector("#running-total"),
    starterCard: document.querySelector("#starter-card"),
    instruction: document.querySelector("#instruction"),
    primaryAction: document.querySelector("#primary-action"),
    secondaryAction: document.querySelector("#secondary-action"),
    scoringDetails: document.querySelector("#scoring-details"),
    eventLog: document.querySelector("#event-log"),
    newMatch: document.querySelector("#new-match"),
    cardTemplate: document.querySelector("#card-template"),
  };

  let state;
  let botTimer = null;

  function createDeck() {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, ...suit, id: `${rank}${suit.symbol}` })));
  }

  function shuffle(cards) {
    const deck = [...cards];
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function cardText(card) { return `${card.rank}${card.symbol}`; }
  function ownerName(owner) { return owner === "player" ? "You" : "Table Bot"; }
  function other(owner) { return owner === "player" ? "bot" : "player"; }
  function cardValue(card) { return RANK_VALUE[card.rank]; }
  function addLog(message) { state.events.unshift(message); state.events = state.events.slice(0, 9); }

  function newMatch() {
    window.clearTimeout(botTimer);
    state = {
      scores: { player: 0, bot: 0 },
      dealer: Math.random() < 0.5 ? "player" : "bot",
      handNumber: 0,
      events: [],
      matchOver: false,
      scoreSummary: null,
    };
    addLog("New table opened. First player to 121 wins.");
    dealHand();
  }

  function dealHand() {
    if (state.matchOver) return;
    window.clearTimeout(botTimer);
    const deck = shuffle(createDeck());
    state.handNumber += 1;
    state.deck = deck;
    state.playerInitial = deck.splice(0, 6);
    state.botInitial = deck.splice(0, 6);
    state.playerHand = [...state.playerInitial];
    state.botHand = [...state.botInitial];
    state.selected = new Set();
    state.crib = [];
    state.starter = null;
    state.pegSequence = [];
    state.runningTotal = 0;
    state.passed = { player: false, bot: false };
    state.phase = "discard";
    state.turn = null;
    state.scoreSummary = null;
    addLog(`Hand ${state.handNumber}: ${ownerName(state.dealer)} has the crib.`);
    render();
  }

  function chooseDiscard(card) {
    if (state.phase !== "discard") return;
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else if (state.selected.size < 2) state.selected.add(card.id);
    render();
  }

  function evaluateFour(cards) {
    const values = cards.map(cardValue);
    const nearFifteen = values.reduce((sum, value) => sum + value, 0);
    const pairs = cards.reduce((sum, card, index) => sum + cards.slice(index + 1).filter((otherCard) => otherCard.rank === card.rank).length * 2, 0);
    const runBonus = longestRun(cards.map((card) => RANK_ORDER[card.rank]));
    return pairs + runBonus * 1.7 + (Math.abs(15 - nearFifteen) <= 2 ? 2 : 0);
  }

  function botDiscard() {
    let best = null;
    state.botHand.forEach((first, firstIndex) => state.botHand.slice(firstIndex + 1).forEach((second) => {
      const keep = state.botHand.filter((card) => card.id !== first.id && card.id !== second.id);
      const cribValue = cardValue(first) + cardValue(second);
      const forOwnCrib = state.dealer === "bot" ? cribValue * 0.17 : -cribValue * 0.11;
      const score = evaluateFour(keep) + forOwnCrib + Math.random() * .45;
      if (!best || score > best.score) best = { cards: [first, second], score };
    }));
    return best.cards;
  }

  function commitDiscards() {
    if (state.phase !== "discard" || state.selected.size !== 2) return;
    const playerDiscard = state.playerHand.filter((card) => state.selected.has(card.id));
    const botCards = botDiscard();
    state.playerHand = state.playerHand.filter((card) => !state.selected.has(card.id));
    state.botHand = state.botHand.filter((card) => !botCards.some((botCard) => botCard.id === card.id));
    state.crib = [...playerDiscard, ...botCards];
    state.starter = state.deck.shift();
    state.phase = "pegging";
    state.turn = other(state.dealer);
    state.selected.clear();
    addLog("Both players added two cards to the crib.");
    if (state.starter.rank === "J") award(state.dealer, 2, "heels — starter jack");
    addLog(`Starter: ${cardText(state.starter)}.`);
    render();
    scheduleBot();
  }

  function legalCards(owner) {
    return state[`${owner}Hand`].filter((card) => state.runningTotal + cardValue(card) <= 31);
  }

  function peggingPoints(sequence, total) {
    const current = sequence[sequence.length - 1].card;
    let points = 0;
    const reasons = [];
    if (total === 15) { points += 2; reasons.push("15 for 2"); }
    if (total === 31) { points += 2; reasons.push("31 for 2"); }
    let matching = 1;
    for (let i = sequence.length - 2; i >= 0 && sequence[i].card.rank === current.rank; i -= 1) matching += 1;
    if (matching === 2) { points += 2; reasons.push("pair"); }
    if (matching === 3) { points += 6; reasons.push("three of a kind"); }
    if (matching === 4) { points += 12; reasons.push("four of a kind"); }
    const run = peggingRun(sequence);
    if (run >= 3) { points += run; reasons.push(`run of ${run}`); }
    return { points, reasons };
  }

  function peggingRun(sequence) {
    for (let length = Math.min(sequence.length, 7); length >= 3; length -= 1) {
      const ranks = sequence.slice(-length).map(({ card }) => RANK_ORDER[card.rank]);
      const unique = new Set(ranks);
      if (unique.size !== length) continue;
      const sorted = [...unique].sort((a, b) => a - b);
      if (sorted.every((rank, index) => index === 0 || rank === sorted[index - 1] + 1)) return length;
    }
    return 0;
  }

  function playCard(owner, cardId) {
    if (state.phase !== "pegging" || state.turn !== owner) return;
    const hand = state[`${owner}Hand`];
    const card = hand.find((candidate) => candidate.id === cardId);
    if (!card || state.runningTotal + cardValue(card) > 31) return;
    state[`${owner}Hand`] = hand.filter((candidate) => candidate.id !== cardId);
    state.pegSequence.push({ card, owner });
    state.runningTotal += cardValue(card);
    state.passed = { player: false, bot: false };
    addLog(`${ownerName(owner)} played ${cardText(card)}. Count ${state.runningTotal}.`);
    const points = peggingPoints(state.pegSequence, state.runningTotal);
    if (points.points) award(owner, points.points, points.reasons.join(", "));
    if (state.matchOver) { render(); return; }
    if (state.runningTotal === 31) {
      resetPegging(owner, true);
      return;
    }
    if (state.playerHand.length === 0 && state.botHand.length === 0) {
      closePegging(owner, "last card");
      return;
    }
    state.turn = other(owner);
    render();
    scheduleBot();
  }

  function passGo(owner) {
    if (state.phase !== "pegging" || state.turn !== owner || legalCards(owner).length) return;
    state.passed[owner] = true;
    addLog(`${ownerName(owner)} says Go.`);
    const next = other(owner);
    if (state.passed[next] || legalCards(next).length === 0) {
      const last = state.pegSequence[state.pegSequence.length - 1];
      closePegging(last.owner, "go");
      return;
    }
    state.turn = next;
    render();
    scheduleBot();
  }

  function resetPegging(lastOwner, exact31) {
    addLog(exact31 ? `${ownerName(lastOwner)} made 31. New sequence.` : "New pegging sequence.");
    state.pegSequence = [];
    state.runningTotal = 0;
    state.passed = { player: false, bot: false };
    if (state.playerHand.length === 0 && state.botHand.length === 0) return scoreHands();
    state.turn = other(lastOwner);
    render();
    scheduleBot();
  }

  function closePegging(lastOwner, reason) {
    if (state.pegSequence.length && state.runningTotal !== 31) award(lastOwner, 1, reason);
    if (state.matchOver) { render(); return; }
    if (state.playerHand.length === 0 && state.botHand.length === 0) return scoreHands();
    resetPegging(lastOwner, false);
  }

  function maybePassBot() {
    if (state.phase !== "pegging" || state.turn !== "bot") return false;
    if (legalCards("bot").length) return false;
    passGo("bot");
    return true;
  }

  function scheduleBot() {
    window.clearTimeout(botTimer);
    if (state.matchOver || state.phase !== "pegging" || state.turn !== "bot") return;
    botTimer = window.setTimeout(() => {
      if (maybePassBot()) return;
      const options = legalCards("bot");
      const card = [...options].sort((a, b) => {
        const aScore = peggingPoints([...state.pegSequence, { card: a, owner: "bot" }], state.runningTotal + cardValue(a)).points;
        const bScore = peggingPoints([...state.pegSequence, { card: b, owner: "bot" }], state.runningTotal + cardValue(b)).points;
        return bScore - aScore || cardValue(b) - cardValue(a);
      })[0];
      playCard("bot", card.id);
    }, 620);
  }

  function scoreHand(cards, starter, isCrib = false) {
    const all = [...cards, starter];
    let fifteens = 0;
    for (let mask = 1; mask < (1 << all.length); mask += 1) {
      const sum = all.reduce((total, card, index) => total + ((mask & (1 << index)) ? cardValue(card) : 0), 0);
      if (sum === 15) fifteens += 1;
    }
    const rankCounts = new Map();
    all.forEach((card) => rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1));
    const pairCombinations = [...rankCounts.values()].reduce((total, count) => total + (count * (count - 1)) / 2, 0);
    const frequencies = new Map();
    all.forEach((card) => frequencies.set(RANK_ORDER[card.rank], (frequencies.get(RANK_ORDER[card.rank]) || 0) + 1));
    const ranks = [...frequencies.keys()].sort((a, b) => a - b);
    const stretches = [];
    let current = [];
    ranks.forEach((rank) => {
      if (!current.length || rank === current[current.length - 1] + 1) current.push(rank);
      else { stretches.push(current); current = [rank]; }
    });
    if (current.length) stretches.push(current);
    const runLength = Math.max(0, ...stretches.map((stretch) => stretch.length));
    const runCombinations = runLength >= 3
      ? stretches.filter((stretch) => stretch.length === runLength).reduce((total, stretch) => total + stretch.reduce((product, rank) => product * frequencies.get(rank), 1), 0)
      : 0;
    const handFlush = cards.every((card) => card.suit === cards[0].suit);
    const flush = handFlush ? (starter.suit === cards[0].suit ? 5 : (isCrib ? 0 : 4)) : 0;
    const nobs = cards.some((card) => card.rank === "J" && card.suit === starter.suit) ? 1 : 0;
    return { total: fifteens * 2 + pairCombinations * 2 + runLength * runCombinations + flush + nobs, fifteens, pairCombinations, runLength, runCombinations, flush, nobs };
  }

  function scoreHands() {
    state.phase = "counting";
    const order = [other(state.dealer), state.dealer, state.dealer];
    const entries = [
      { owner: other(state.dealer), name: `${ownerName(other(state.dealer))}'s hand`, cards: state[`${other(state.dealer)}HandInitial`] || state[`${other(state.dealer)}Initial`].filter((card) => !state.crib.some((cribCard) => cribCard.id === card.id)), crib: false },
      { owner: state.dealer, name: `${ownerName(state.dealer)}'s hand`, cards: state[`${state.dealer}Initial`].filter((card) => !state.crib.some((cribCard) => cribCard.id === card.id)), crib: false },
      { owner: state.dealer, name: `${ownerName(state.dealer)}'s crib`, cards: state.crib, crib: true },
    ];
    const scores = entries.map((entry) => ({ ...entry, result: scoreHand(entry.cards, state.starter, entry.crib) }));
    state.scoreSummary = scores;
    scores.forEach(({ owner, name, result }) => {
      if (state.matchOver) return;
      if (result.total) award(owner, result.total, name);
      addLog(`${name} scores ${result.total}.`);
    });
    if (!state.matchOver) {
      state.phase = "between";
      state.dealer = other(state.dealer);
      addLog(`${ownerName(state.dealer)} deals next hand.`);
    }
    render();
  }

  function award(owner, points, reason) {
    state.scores[owner] += points;
    addLog(`${ownerName(owner)} +${points}${reason ? ` — ${reason}` : ""}.`);
    if (state.scores[owner] >= TARGET_SCORE) {
      state.matchOver = true;
      state.phase = "gameover";
      addLog(`${ownerName(owner)} wins the match!`);
    }
  }

  function longestRun(ranks) {
    const unique = [...new Set(ranks)].sort((a, b) => a - b);
    let longest = 1;
    let running = 1;
    for (let i = 1; i < unique.length; i += 1) {
      running = unique[i] === unique[i - 1] + 1 ? running + 1 : 1;
      longest = Math.max(longest, running);
    }
    return longest >= 3 ? longest : 0;
  }

  function makeCard(card, { disabled = false, selected = false, back = false, click = null, compact = false } = {}) {
    if (back) {
      const cardButton = document.createElement("div");
      cardButton.className = `card back${compact ? " compact" : ""}`;
      cardButton.setAttribute("aria-hidden", "true");
      return cardButton;
    }
    const node = ui.cardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".card-rank").textContent = card.rank;
    node.querySelector(".card-suit").textContent = card.symbol;
    node.classList.toggle("red", card.color === "red");
    node.classList.toggle("selected", selected);
    node.disabled = disabled;
    node.setAttribute("aria-label", `${card.rank} of ${card.name}`);
    if (click) node.addEventListener("click", click);
    return node;
  }

  function replaceChildren(element, children) { element.replaceChildren(...children); }

  function phaseCopy() {
    if (state.phase === "discard") return { title: "Choose two cards for the crib", chip: "Your discard", instruction: "Pick two cards from your six-card hand. The crib belongs to the dealer this hand.", action: "Add to crib" };
    if (state.phase === "pegging") {
      if (state.turn === "player") return { title: "Peg to 31", chip: "Your turn", instruction: "Play any card that does not take the count over 31. If none fit, say Go.", action: "Play a card" };
      return { title: "Peg to 31", chip: "Bot thinking", instruction: "Table Bot is choosing a legal card.", action: "Bot's turn" };
    }
    if (state.phase === "between") return { title: "Hand scored", chip: "Ready", instruction: "Review the score breakdown, then deal the next hand.", action: "Deal next hand" };
    if (state.phase === "gameover") return { title: `${state.scores.player >= TARGET_SCORE ? "You win!" : "Table Bot wins"}`, chip: "Match complete", instruction: "Start a fresh match whenever you are ready.", action: "Play again" };
    return { title: "Counting hands", chip: "Scoring", instruction: "Adding the hand and crib points.", action: "Scoring" };
  }

  function renderScores() {
    ui.playerScore.textContent = state.scores.player;
    ui.botScore.textContent = state.scores.bot;
    ui.playerPeg.style.width = `${Math.min(100, (state.scores.player / TARGET_SCORE) * 100)}%`;
    ui.botPeg.style.width = `${Math.min(100, (state.scores.bot / TARGET_SCORE) * 100)}%`;
    ui.handLabel.textContent = `Hand ${state.handNumber}`;
    ui.dealerLabel.textContent = `Dealer: ${ownerName(state.dealer)}`;
  }

  function renderHands() {
    const discard = state.phase === "discard";
    const playerPlayable = state.phase === "pegging" && state.turn === "player";
    replaceChildren(ui.playerHand, state.playerHand.map((card) => makeCard(card, {
      selected: discard && state.selected.has(card.id),
      disabled: !(discard || (playerPlayable && state.runningTotal + cardValue(card) <= 31)),
      click: discard ? () => chooseDiscard(card) : () => playCard("player", card.id),
    })));
    const revealBot = state.phase === "between" || state.phase === "gameover";
    replaceChildren(ui.botHand, state.botHand.map((card) => revealBot ? makeCard(card, { disabled: true }) : makeCard(null, { back: true })));
    ui.botCardCount.textContent = `${state.botHand.length} ${state.botHand.length === 1 ? "card" : "cards"}`;
    ui.selectionCount.textContent = discard ? `${state.selected.size}/2 selected` : `${state.playerHand.length} ${state.playerHand.length === 1 ? "card" : "cards"}`;
  }

  function renderCenter() {
    const revealCrib = state.phase === "between" || state.phase === "gameover";
    replaceChildren(ui.cribCards, state.crib.map((card) => revealCrib ? makeCard(card, { disabled: true, compact: true }) : makeCard(null, { back: true, compact: true })));
    ui.cribOwner.textContent = `${ownerName(state.dealer)}'s crib`;
    replaceChildren(ui.peggingCards, state.pegSequence.map(({ card }) => makeCard(card, { disabled: true, compact: true })));
    ui.runningTotal.textContent = state.runningTotal;
    const replacement = state.starter ? makeStarter(state.starter) : starterPlaceholder();
    ui.starterCard.replaceWith(replacement);
    ui.starterCard = replacement;
  }

  function starterPlaceholder() { const node = document.createElement("div"); node.id = "starter-card"; node.className = "starter-card placeholder"; node.textContent = "?"; return node; }
  function makeStarter(card) { const node = makeCard(card, { disabled: true }); node.id = "starter-card"; node.classList.add("starter-card"); return node; }

  function renderSidePanel() {
    const copy = phaseCopy();
    ui.phaseTitle.textContent = copy.title;
    ui.turnChip.textContent = copy.chip;
    ui.instruction.textContent = copy.instruction;
    ui.primaryAction.textContent = copy.action;
    ui.primaryAction.disabled = (state.phase === "discard" && state.selected.size !== 2) || state.phase === "pegging" || state.phase === "counting";
    ui.primaryAction.onclick = () => {
      if (state.phase === "discard") commitDiscards();
      else if (state.phase === "between") dealHand();
      else if (state.phase === "gameover") newMatch();
    };
    const playerCannotPlay = state.phase === "pegging" && state.turn === "player" && legalCards("player").length === 0;
    ui.secondaryAction.hidden = !playerCannotPlay;
    ui.secondaryAction.textContent = "Go";
    ui.secondaryAction.onclick = () => passGo("player");
    if (!state.scoreSummary) {
      ui.scoringDetails.innerHTML = '<p class="muted">Pegging bonuses and hand totals will appear here.</p>';
    } else {
      ui.scoringDetails.replaceChildren(...state.scoreSummary.map(({ name, result }) => {
        const row = document.createElement("div"); row.className = "score-row";
        const label = document.createElement("span");
        const notes = [];
        if (result.fifteens) notes.push(`${result.fifteens} fifteen${result.fifteens === 1 ? "" : "s"}`);
        if (result.pairCombinations) notes.push(`${result.pairCombinations} pair${result.pairCombinations === 1 ? "" : "s"}`);
        if (result.runLength) notes.push(`run of ${result.runLength}${result.runCombinations > 1 ? ` ×${result.runCombinations}` : ""}`);
        if (result.flush) notes.push(`${result.flush}-card flush`);
        if (result.nobs) notes.push("nobs");
        label.textContent = `${name}: ${notes.join(", ") || "no combinations"}`;
        const total = document.createElement("strong"); total.textContent = `+${result.total}`;
        row.append(label, total); return row;
      }));
    }
    replaceChildren(ui.eventLog, state.events.map((event) => { const item = document.createElement("li"); item.textContent = event; return item; }));
  }

  function render() { renderScores(); renderHands(); renderCenter(); renderSidePanel(); }
  ui.newMatch.addEventListener("click", newMatch);
  newMatch();
})();
