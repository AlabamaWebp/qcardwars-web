import { Injectable, computed, signal } from '@angular/core';
import type { LaneType } from '@qcw/game-core';

export type Lang = 'en' | 'ru';

/**
 * Minimal EN/RU localization (request: "перевод всего приложения на русский").
 * No dependency: a flat key dictionary + a `qcw.lang` localStorage slot.
 * Translated: all UI chrome (lobby, board, modals, buttons, hints, lane and
 * faction names). NOT translated (documented limitation): card names /
 * descriptions and engine log / server error texts — they arrive as
 * authoritative English strings from game-core / the server.
 */
const STRINGS = {
  'app.restoring': ['Restoring session…', 'Восстановление сессии…'],
  'app.goLobby': ['Go to lobby', 'В лобби'],
  'lang.toggle': ['RU', 'EN'],
  'lang.label': ['Switch to Russian', 'Переключить на английский'],

  'lobby.eyebrow': ['browser / LAN prototype', 'браузер / LAN-прототип'],
  'lobby.tagline': [
    'Four lanes. Typed units. Growing mana. Build pressure, use powers, survive long enough to trigger specials.',
    'Четыре линии. Юниты по фракциям. Растущая мана. Давите, используйте силы и доживите до спецударов.',
  ],
  'lobby.online': ['server connected', 'сервер подключён'],
  'lobby.offline': ['connecting…', 'подключение…'],
  'lobby.playerName': ['Player name', 'Имя игрока'],
  'lobby.yourLanes': ['Your lanes — choose 4 (repeats allowed)', 'Ваши линии — выберите 4 (повторы можно)'],
  'lobby.yourHint': [
    'Exactly four lanes — repeats allowed, so a faction can fill more than one lane. Only your chosen lane factions fill your deck.',
    'Ровно четыре линии — повторы разрешены, фракция может занять несколько линий. В вашу колоду попадут только карты ваших фракций.',
  ],
  'lobby.aiLanes': ['AI lanes — used for Play solo (repeats allowed)', 'Линии ИИ — для игры соло (повторы можно)'],
  'lobby.aiHint': [
    'The AI gets its own 4 lanes, so its side — and its deck — may differ from yours. Roll the dice for a random set.',
    'У ИИ свои 4 линии: его сторона и колода могут отличаться от ваших. Кубик — случайный набор.',
  ],
  'lobby.create': ['Create room', 'Создать комнату'],
  'lobby.solo': ['Play solo (vs AI)', 'Играть соло (против ИИ)'],
  'lobby.dice': ['Random AI lanes', 'Случайные линии ИИ'],
  'lobby.joinTitle': ['Join with your own 4 lanes (repeats allowed)', 'Вход со своими 4 линиями (повторы можно)'],
  'lobby.joinHint': [
    'Your side of the board — and your deck — uses these lanes. Leave them to mirror the room creator.',
    'Ваша сторона поля и ваша колода будут из этих линий. Не трогайте, чтобы зеркалить создателя.',
  ],
  'lobby.join': ['Join', 'Войти'],
  'lobby.code': ['ROOM CODE', 'КОД'],
  'lobby.share': ['Share the code with player 2. Match starts automatically.', 'Поделитесь кодом со вторым игроком. Матч начнётся сам.'],
  'lobby.leave': ['Leave room', 'Покинуть комнату'],
  'lobby.reconnected': ['Reconnected — session restored.', 'Переподключено — сессия восстановлена.'],
  'lobby.ready': ['ready', 'готов'],
  'lobby.waiting': ['disconnected — waiting to rejoin…', 'отключён — ждём возвращения…'],

  'game.lobby': ['← Lobby', '← Лобби'],
  'game.room': ['room', 'комната'],
  'game.yourTurn': ['YOUR TURN', 'ВАШ ХОД'],
  'game.oppTurn': ['OPPONENT TURN', 'ХОД СОПЕРНИКА'],
  'game.over': ['MATCH OVER', 'МАТЧ ОКОНЧЕН'],
  'game.reconnected': ['reconnected', 'переподключено'],
  'game.soundOn': ['Sound on — click to mute', 'Звук вкл — нажать, чтобы выключить'],
  'game.soundOff': ['Sound off — click to unmute', 'Звук выкл — нажать, чтобы включить'],
  'game.endTurn': ['End turn', 'Завершить ход'],
  'game.online': ['online', 'в сети'],
  'game.offline': ['disconnected', 'отключён'],
  'game.hp': ['HP', 'ХП'],
  'game.mana': ['Mana', 'Мана'],
  'game.hand': ['Hand', 'Рука'],
  'game.deck': ['Deck', 'Колода'],
  'game.yourHand': ['Your hand', 'Ваша рука'],
  'game.playableNow': ['playable now', 'можно сыграть'],
  'game.you': ['you', 'вы'],
  'game.foe': ['foe', 'враг'],
  'game.yourUnit': ['your unit', 'ваш юнит'],
  'game.enemyUnit': ['enemy unit', 'юнит врага'],
  'game.selA': ['Selected', 'Выбрано'],
  'game.selB': ['. Click a lane/target to play. Click the card again to cancel.', '. Кликните линию/цель, чтобы сыграть. Повторный клик отменяет выбор.'],
  'game.hintEmpty': [
    'Select a card, or click one of your surviving units to attempt its special.',
    'Выберите карту или кликните своего юнита, чтобы применить спецудар.',
  ],
  'game.waitHint': ['Plan your next move — the opponent is acting.', 'Продумайте следующий ход — сейчас действует соперник.'],
  'game.chooseLane': ['Choose one of the glowing legal lanes.', 'Выберите одну из подсвеченных доступных линий.'],
  'game.chooseBuildingLane': ['Choose a glowing lane with a free building slot.', 'Выберите подсвеченную линию со свободным местом для здания.'],
  'game.chooseHero': ['Click the highlighted enemy hero panel.', 'Нажмите на подсвеченную панель героя соперника.'],
  'game.chooseEnemyUnit': ['Choose a glowing enemy unit.', 'Выберите подсвеченного вражеского юнита.'],
  'game.chooseFriendlyUnit': ['Choose a glowing friendly unit.', 'Выберите подсвеченного союзного юнита.'],
  'game.chooseEnemyBuilding': ['Choose a glowing enemy building.', 'Выберите подсвеченное вражеское здание.'],
  'game.chooseEffectLane': ['Choose a glowing lane.', 'Выберите подсвеченную линию.'],
  'game.noTargetNeeded': ['No target needed — confirm to use it.', 'Цель не нужна — подтвердите применение.'],
  'game.chooseSpecialTarget': ['Special selected — choose a glowing target.', 'Спецудар выбран — укажите подсвеченную цель.'],
  'game.targetHero': ['Target hero', 'Цель: герой'],
  'game.useCard': ['Use card', 'Применить'],
  'game.cancel': ['Cancel', 'Отмена'],
  'game.attacksNow': ['Attacks when this turn ends', 'Атакует в конце этого хода'],
  'game.specialReady': ['ready', 'готово'],
  'game.specialSleeping': ['ready next turn', 'готово со следующего хода'],
  'game.specialSpent': ['no uses left', 'заряды исчерпаны'],
  'game.specialNoTarget': ['no valid target', 'нет подходящей цели'],
  'game.manaShort': ['mana', 'маны'],
  'game.log': ['Combat log', 'Журнал боя'],
  'game.fullLog': ['Full log', 'Полный лог'],
  'game.fullLogTitle': ['full match log', 'полный журнал матча'],
  'game.logTitle': ['Log', 'Журнал'],
  'game.noEntries': ['No entries yet.', 'Пока пусто.'],
  'game.close': ['Close', 'Закрыть'],
  'game.fatigueYou': ['Empty deck: you take', 'Колода пуста: вы получаете'],
  'game.fatigueFoe': ['Empty deck: takes', 'Колода пуста: получает'],
  'game.fatigueTail': ['damage on each empty draw (grows by 1 each time)', 'урона за каждую пустую доборку (растёт на 1 каждый раз)'],
  'game.victory': ['Victory', 'Победа'],
  'game.defeat': ['Defeat', 'Поражение'],
  'game.matchComplete': ['match complete', 'матч завершён'],
  'game.turns': ['Turns', 'Ходы'],
  'game.cards': ['Cards', 'Карты'],
  'game.kills': ['Kills', 'Фраги'],
  'game.dmg': ['Dmg', 'Урон'],
  'game.soloNote': [
    'Solo match: the AI auto-rematches, so your confirmation starts the next match immediately.',
    'Соло-матч: ИИ подтверждает реванш сам, ваша кнопка сразу начнёт следующий матч.',
  ],
  'game.leftNote': [
    'Your opponent has left the match — no rematch is possible. Return to the lobby to create or join a room.',
    'Соперник покинул матч — реванш невозможен. Вернитесь в лобби, чтобы создать комнату или войти.',
  ],
  'game.handshakeNote': [
    'A two-player rematch handshake: both players must confirm.',
    'Реванш для двоих: подтвердить должны оба игрока.',
  ],
  'game.waitingNote': [
    'Waiting for your opponent to confirm the rematch…',
    'Ждём подтверждения реванша соперником…',
  ],
  'game.startingNote': ['Starting rematch…', 'Начинаем реванш…'],
  'game.rematch': ['Request rematch', 'Реванш'],
  'game.rematchAi': ['Rematch vs AI', 'Реванш с ИИ'],
  'game.returnLobby': ['Return to lobby', 'В лобби'],

  'faction.antlion': ['antlion', 'муравьиный лев'],
  'faction.combine': ['combine', 'альянс'],
  'faction.rebel': ['rebel', 'повстанец'],
  'faction.zombie': ['zombie', 'зомби'],
  'faction.guardian': ['guardian', 'страж'],
  'faction.wraith': ['wraith', 'призрак'],
} as const;

export type I18nKey = keyof typeof STRINGS;

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem('qcw.lang');
    if (stored === 'ru' || stored === 'en') return stored;
    if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru')) return 'ru';
  } catch {
    // Storage unavailable: fall through to English.
  }
  return 'en';
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(detectLang());
  readonly isRu = computed(() => this.lang() === 'ru');

  t(key: I18nKey): string {
    const pair = STRINGS[key];
    return this.lang() === 'ru' ? pair[1] : pair[0];
  }

  /** Localized lane/faction name for board frames and pickers. */
  faction(type: LaneType | 'universal'): string {
    if (type === 'universal') return type;
    return this.t(`faction.${type}` as I18nKey);
  }

  toggle(): void {
    const next: Lang = this.lang() === 'ru' ? 'en' : 'ru';
    this.lang.set(next);
    try {
      localStorage.setItem('qcw.lang', next);
    } catch {
      // Private mode etc.: the toggle still works for this session.
    }
  }
}
