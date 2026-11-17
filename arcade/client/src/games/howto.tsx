import { Accordion, B } from '../shell/ui';

const Sub = ({ children }: { children: React.ReactNode }) => <p className="pt-1 text-xs font-bold text-ash/70">{children}</p>;

export function StandupHowTo() {
  return (
    <>
      <Accordion title="How to play">
        <p>Each round, one player draws a card with a mundane office task, like <i className="text-ash">“Refilled the water cooler”</i> or <i className="text-ash">“Cleared a jam from the printer.”</i></p>
        <p>Their job is to deliver a completely <B>over-the-top standup update</B> about it, as if they spent the whole day heroically solving a crisis. Think big. Think corporate. Think insufferable.</p>
        <p>Everyone else rates the performance from 1 to 5. The speaker scores ten times the average rating.</p>
        <p className="text-xs">You get 60 seconds, starting when you flip your card. Most points after everyone has spoken wins.</p>
      </Accordion>
      <Accordion title="Example" tone="ash">
        <Sub>Card</Sub>
        <p className="italic text-ash">“Refilled the water cooler”</p>
        <Sub>A good stretch (true, but inflated)</Sub>
        <p>“I worked with maintenance to restock key supplies on floor 3 that hundreds of employees rely on daily.”</p>
        <Sub>A bad lie (not what the card says)</Sub>
        <p>“I improved productivity across the workforce through enhanced hydration initiatives company-wide.”</p>
        <p className="text-xs">Stretch the truth, don’t replace it. Stay close enough to be believable.</p>
      </Accordion>
    </>
  );
}

export function OneOHowTo() {
  return (
    <>
      <Accordion title="How to play">
        <p>Each player starts with <B>7 cards</B>. On your turn, play a card that matches the top of the discard pile by <B>color or number</B>.</p>
        <p>If you can’t play, <B>draw one card</B>. If the drawn card is playable you may play it right away; otherwise your turn ends.</p>
        <Sub>Special cards</Sub>
        <ul className="space-y-1">
          <li><B>Skip</B>: the next player loses their turn.</li>
          <li><B>Reverse</B>: flips the direction of play.</li>
          <li><B>Draw Two</B>: the next player draws 2 and is skipped.</li>
          <li><B>Wild</B>: play on anything; you choose the next color.</li>
          <li><B>Wild Draw Four</B>: the next player draws 4 and is skipped; you choose the color.</li>
        </ul>
        <p className="text-xs">First player to empty their hand wins.</p>
      </Accordion>
      <Accordion title="Example" tone="ash">
        <Sub>Top of the discard pile</Sub>
        <p className="text-ash">Red 7</p>
        <Sub>You can play</Sub>
        <p>Any red card (Red 2), any 7 (Blue 7), or a Wild.</p>
        <Sub>You can’t play</Sub>
        <p>Blue 3: wrong color and wrong number. Draw a card instead.</p>
      </Accordion>
    </>
  );
}

export function VaultHowTo() {
  return (
    <>
      <Accordion title="How to play">
        <p>Everyone starts with <B>5 gold cards</B> and <B>1 skull card</B>. Cards are played face-down into a shared pile, and that pile is what you gamble against.</p>
        <Sub>Round 1: seed the vault</Sub>
        <p>Every player plays one card into the pile. No gambling yet.</p>
        <Sub>From round 2: your turn</Sub>
        <p><B>Play a card</B> (gold or skull) into the pile, <i>or</i> <B>gamble</B>: say how many cards you’ll flip, then flip them one at a time.</p>
        <ul className="space-y-1 pl-3">
          <li>💰 Gold: you keep 1 gold. Keep flipping until you’ve hit your number.</li>
          <li>💀 Skull: everything you flipped is shuffled back in and you lose the skull from your hand. No skull left to lose? You’re <span className="font-semibold text-danger">out</span>.</li>
        </ul>
        <p>Finish your flips safely and you must play one card from your hand into the pile.</p>
        <Sub>Winning</Sub>
        <p>Reach <B>10 gold</B>, or be the last player standing.</p>
        <p className="text-xs">The twist: skulls are only in the pile because players put them there.</p>
      </Accordion>
      <Accordion title="Example" tone="ash">
        <Sub>After round 1 (2 players)</Sub>
        <p>The pile has 2 gold. You each hold 4 gold and a skull.</p>
        <Sub>Opponent’s turn</Sub>
        <p>They slip their <B>skull</B> into the pile. It now holds 2 gold and 1 skull.</p>
        <Sub>Your turn</Sub>
        <p>You gamble 2. First flip: 💰, you’re up to 5 gold. Second flip: 💀. Both cards go back, the pile is shuffled, and your skull card is gone. Hit another skull later and you’re out.</p>
      </Accordion>
    </>
  );
}

export function LastStandHowTo() {
  return (
    <Accordion title="How to play">
      <p>Everyone gets the same hand, cards <B>1 to 10</B>, and <B>3 lives</B>. Each round everyone secretly picks a card and locks it in. All cards flip at once.</p>
      <ul className="space-y-1">
        <li><span className="font-semibold text-flame">Highest unique card</span> wins the round.</li>
        <li><span className="font-semibold text-danger">Lowest unique card</span> loses a life.</li>
        <li><B>Matching cards cancel out</B>: those players can’t win or lose this round.</li>
      </ul>
      <p>Played cards are <B>gone for good</B>, and everyone can see how many cards you have left.</p>
      <Sub>Winning</Sub>
      <p>Lose all your lives and you’re out. Last player standing wins. If the cards run out first, most lives wins.</p>
      <p className="text-xs">Two players tie three rounds running? Sudden death: both play their highest card.</p>
      <p className="text-xs">Example: 10, 10, 5, 3. The 10s cancel, the 5 wins, the 3 loses a life.</p>
    </Accordion>
  );
}

export function FortressHowTo() {
  return <Accordion title="How to play Protect Thy Fortress">
    <p><B>Hold the walls together.</B> Grab a skeleton, drag it upward and release to fling it. Throw into the horde for extra kills.</p>
    <p>Archers attack automatically. Spend gold between waves on troops, mages, engineers and repairs. Everyone readies up for the next wave.</p>
    <p>One player can choose <B>artillery</B>: tap to aim and fire bouncing discs. Hit a flying skeleton for a combo. Late arrivals watch until the next shop.</p>
  </Accordion>;
}
