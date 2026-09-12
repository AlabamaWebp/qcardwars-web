import { Injectable, computed, signal } from '@angular/core';
import type { LaneType } from '@qcw/game-core';

export type Lang = 'en' | 'ru';

/**
 * Minimal EN/RU localization (request: "перевод всего приложения на русский").
 * No dependency: a flat key dictionary + a `qcw.lang` localStorage slot.
 * Translated: all UI chrome plus card descriptions and special descriptions.
 * Card names remain canonical gameplay data; engine logs and server errors are
 * also intentionally left untouched because they are authoritative strings.
 */

const CARD_DESCRIPTIONS_RU: Record<string, string> = {
  bucket: 'Запасной юнит: простой, надёжный и неизбежный.',
  'antlion-runner': 'Быстрое давление на линию за низкую стоимость.',
  'antlion-worker': 'После выживания в течение хода может плюнуть кислотой во вражеский юнит.',
  'antlion-guard': 'Тяжёлое существо с разрушительным рывком.',
  'combine-metrocop': 'Надёжный боец Альянса.',
  'combine-soldier': 'Может усилить союзный юнит.',
  'combine-elite': 'Дорогой финишер, способный стрелять прямо по вражескому герою.',
  'rebel-scout': 'Дешёвый боец повстанцев.',
  'rebel-medic': 'Помогает союзным юнитам выжить.',
  'rebel-veteran': 'Может превратить союзника в более серьёзную угрозу.',
  'zombie-shambler': 'Медленный, но живучий.',
  'zombie-fast': 'Агрессивный зомби, способный исцелять себя.',
  'zombie-poison': 'Крупный источник постоянного давления на линию.',
  'universal-mercenary': 'Универсальный юнит для любой линии.',
  'antlion-tinker': 'После выживания в течение хода плюётся летучей кислотой во вражеский юнит.',
  'combine-laser': 'Наводит лазер на союзника, усиливая его оружие.',
  'rebel-commander': 'Ведёт сопротивление и вызывает подкрепление.',
  'zombie-bloater': 'Раздувшийся ужас, который по команде взрывается и обжигает героя врага.',
  'building-field-hospital': 'В начале вашего хода исцеляет вашего юнита на этой линии на 1 ОЗ.',
  'building-ammo-cache': 'Ваш юнит на этой линии получает +1 к атаке при атаке.',
  'building-nest': 'Ваш юнит на этой линии получает +1 к атаке при атаке.',
  'building-grave-mound': 'В начале вашего хода исцеляет вашего юнита на этой линии на 1 ОЗ.',
  'building-bunker': 'Ваш юнит на этой линии получает +1 к атаке при атаке.',
  'power-strike': 'Наносит вражескому юниту 3 урона.',
  'power-rally': 'Даёт союзному юниту +2 к атаке и +2 к ОЗ.',
  'power-shelling': 'Наносит вражескому герою 4 прямого урона.',
  'power-sabotage': 'Уничтожает вражеское здание.',
  'power-resupply': 'Добирает 2 карты.',
  'power-berserk': 'Даёт союзному юниту +2 к атаке и +0 к ОЗ.',
  'power-venom': 'Отравляет юнита: наносит 2 урона в начале следующих 2 ходов его владельца.',
  'power-rot': 'Оскверняет юнита: наносит 1 урон в начале следующих 3 ходов его владельца.',
  'power-scorch': 'Наносит 2 урона каждому юниту на линии — с обеих сторон.',
  'power-mend': 'Восстанавливает вашему герою 3 ОЗ (не выше максимума).',
  'power-overcharge': 'Даёт 2 маны (не выше максимума).',
  'power-salvage': 'Добавляет Наёмника в вашу руку (теряется при полной руке).',
  'power-execution': 'Уничтожает вражеский юнит.',
  'power-wither': 'Уменьшает атаку вражеского юнита на 2 и наносит ему 1 урон.',
  'antlion-spitter': 'Покрывает добычу ядом, который продолжает действовать.',
  'rebel-engineer': 'Поддерживает сопротивление, включая героя.',
  'combine-drone': 'Жужжащий ретранслятор, подключённый к сети Альянса.',
  'antlion-swarm': 'Дешёвое давление числом.',
  'antlion-hunter': 'Разрывает добычу ещё до приземления.',
  'antlion-queen': 'Откладывает яйца, из которых вылупляются новые рои.',
  'building-larva-pool': 'В начале вашего хода исцеляет вашего юнита на этой линии на 1 ОЗ.',
  'power-acid-rain': 'Наносит 2 урона каждому юниту на линии — с обеих сторон.',
  'combine-juggernaut': 'Неостановимый бронированный финишер.',
  'building-power-substation': 'Ваш юнит на этой линии получает +2 к атаке при атаке.',
  'rebel-guerrilla': 'Дешёвое, упрямое давление на линию.',
  'rebel-ambusher': 'Атакует из засады ядовитым клинком.',
  'building-supply-drop': 'В начале вашего хода исцеляет вашего юнита на этой линии на 2 ОЗ.',
  'power-medic-convoy': 'Восстанавливает вашему герою 5 ОЗ (не выше максимума).',
  'power-landmine': 'Наносит 3 урона каждому юниту на линии — с обеих сторон.',
  'zombie-ghoul': 'Голодный и неумолимый.',
  'zombie-plague': 'Его дыхание распространяет гниющую инфекцию.',
  'zombie-brute': 'Огромная масса гниющих мышц.',
  'zombie-titan': 'Башнеподобная стена нежити.',
  'building-tomb': 'В начале вашего хода исцеляет вашего юнита на этой линии на 2 ОЗ.',
  'power-extermination': 'Уничтожает вражеский юнит.',
  'universal-guard': 'Крепкая защита для любой линии.',
  'power-overclock': 'Даёт 3 маны (не выше максимума).',
  'guardian-sentinel': 'Терпеливая стена из камня и света.',
  'guardian-priest': 'Спокойной сияющей рукой залечивает раны.',
  'guardian-bulwark': 'Непробиваемый бастион, укрепляющий союзников.',
  'building-sacred-shrine': 'В начале вашего хода исцеляет вашего юнита на этой линии на 1 ОЗ.',
  'power-sacred-light': 'Восстанавливает вашему герою 3 ОЗ (не выше максимума).',
  'power-holy-shield': 'Даёт союзному юниту +0 к атаке и +3 к ОЗ.',
  'wraith-stalker': 'Атакует прежде, чем его успевают заметить.',
  'wraith-reaper': 'Его прикосновение иссушает плоть.',
  'wraith-lord': 'Пустая корона, пьющая силу живых.',
  'building-wraith-alter': 'Ваш юнит на этой линии получает +1 к атаке при атаке.',
  'power-haunt': 'Преследует юнита: наносит 2 урона в начале следующих 2 ходов его владельца.',
  'power-soul-theft': 'Уменьшает атаку вражеского юнита на 1, наносит ему 2 урона и восстанавливает вашему герою 2 ОЗ.',
  'power-stasis-field': 'Оглушает вражеский юнит: тот пропускает следующую атаку.',
  'power-terror-raid': 'Запугивает врага: он сбрасывает 2 случайные карты.',
  'universal-demolition-volunteer': 'Заряд взрывчатки, который становится сильнее с каждым союзником рядом.',
  'universal-drill-sergeant': 'Сразу после выхода в бой отдаёт приказ: получает +1 к атаке.',
  'antlion-tunnel-harrier': 'Вырывается из норы и при ударе ослабляет добычу: -1 к атаке вражеского юнита.',
  'antlion-chitin-skirmisher': 'Закалённый рейдер при ударе ломает добычу: -2 к атаке вражеского юнита.',
  'antlion-nectar-swarm': 'Жужжащая туча, разрастающаяся с каждым союзником поблизости.',
  'combine-riot-marshal': 'Сразу после вступления в бой вызывает подкрепление: добирает 1 карту.',
  'combine-metro-bouncer': 'Выбрасывает выбранного вражеского юнита обратно в руку его владельца.',
  'rebel-propaganda-runner': 'Передаёт дерзкое сообщение и жалит героя врага: 1 урон герою при выходе.',
  'rebel-wrench-tinker': 'Уничтожив вражеский юнит в бою, отправляет запчасть в руку: добирает 1 карту.',
  'zombie-rotting-warden': 'Покрывает цель гнилью: 2 урона в начале следующих 2 ходов её владельца.',
  'zombie-plague-bearer': 'Выпускает заразные споры: 3 урона цели в течение 2 ходов.',
  'wraith-phantom-harrier': 'Окутывает цель холодом и крадёт её следующую атаку: оглушение 1.',
  'guardian-sacred-sentinel': 'Окружает себя ореолом божественной защиты.',
};

const SPECIAL_DESCRIPTIONS_RU: Record<string, string> = {
  'antlion-worker': 'Наносит вражескому юниту 3 урона.', 'antlion-guard': 'Уничтожает себя и наносит 7 урона вражескому юниту.',
  'combine-soldier': 'Даёт союзному юниту +2 к атаке и +1 к ОЗ.', 'combine-elite': 'Наносит герою врага 3 прямого урона.',
  'rebel-medic': 'Исцеляет союзного юнита на 4 ОЗ.', 'rebel-veteran': 'Даёт союзному юниту +1 к атаке и +3 к ОЗ.',
  'zombie-fast': 'Исцеляет себя на 3 ОЗ.', 'antlion-tinker': 'Наносит вражескому юниту 3 урона.',
  'combine-laser': 'Даёт союзному юниту +2 к атаке и +0 к ОЗ.', 'rebel-commander': 'Добирает 1 карту.',
  'zombie-bloater': 'Наносит герою врага 1 урон, затем уничтожает себя.', 'antlion-spitter': 'Отравляет вражеский юнит: 2 урона в начале следующих 2 ходов его владельца.',
  'rebel-engineer': 'Восстанавливает вашему герою 2 ОЗ (не выше максимума).', 'combine-drone': 'Даёт 2 маны (не выше максимума).',
  'antlion-hunter': 'Уменьшает атаку вражеского юнита на 1 и наносит ему 2 урона.', 'antlion-queen': 'Добавляет Рой жуков в руку (теряется при полной руке).',
  'combine-juggernaut': 'Уничтожает вражеский юнит.', 'rebel-ambusher': 'Отравляет вражеский юнит: 2 урона в начале следующих 2 ходов его владельца.',
  'zombie-plague': 'Отравляет вражеский юнит: 3 урона в начале следующих 2 ходов его владельца.', 'zombie-brute': 'Уменьшает атаку вражеского юнита на 2 и наносит ему 1 урон.',
  'guardian-priest': 'Исцеляет союзного юнита на 4 ОЗ.', 'guardian-bulwark': 'Даёт союзному юниту +0 к атаке и +4 к ОЗ.',
  'wraith-reaper': 'Наносит вражескому юниту 3 урона.', 'wraith-lord': 'Уменьшает атаку вражеского юнита на 2 и наносит ему 2 урона.',
  'guardian-sacred-sentinel': 'Благословляет себя: +2 к атаке и +2 к ОЗ.', 'combine-metro-bouncer': 'Возвращает вражеского юнита в руку его владельца.',
};
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
  'game.cardDetails': ['Card details', 'Подробнее о карте'],
  'game.target': ['Target', 'Цель'],
  'game.passive': ['Passive', 'Пассивный эффект'],
  'game.onPlay': ['On play', 'При розыгрыше'],
  'game.swarm': ['Swarm', 'Рой'],
  'game.perAlly': ['per other ally', 'за каждого другого союзника'],
  'game.onKill': ['On kill', 'При уничтожении'],
  'game.drawCards': ['draw cards:', 'добор карт:'],
  'game.special': ['Special', 'Спецудар'],
  'game.uses': ['uses', 'заряда'],
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

  cardDescription(cardId: string, fallback: string): string {
    return this.isRu() ? (CARD_DESCRIPTIONS_RU[cardId] ?? fallback) : fallback;
  }

  specialDescription(cardId: string, fallback: string): string {
    return this.isRu() ? (SPECIAL_DESCRIPTIONS_RU[cardId] ?? fallback) : fallback;
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
