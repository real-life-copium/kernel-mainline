// @ts-check

/**
 * Node.js TTY progress bar
 *
 * log the progress of a task in the same line
 * use green and red colors to indicate progress
 * green: downloaded
 * red: remaining
 * reset color at the end
 *
 * PROGRESS ━━━━━━━━━━━━━━━━━━━━━━━━  70%  1.2MB/s  3m1s
 **/
export default class ProgressBar {
  /**
   * @param {number} total
   * @param {boolean} keep
   * @param {NodeJS.WriteStream} tty
   **/
  constructor(total, keep, tty = process.stdout) {
    this.total = total;
    this.keep = keep;
    this.tty = tty;

    this.current = 0;
    this.start = Date.now();

    this.batch = 0;
    this.last = this.start;
  }

  get width() {
    return this.tty.columns ?? 80;
  }

  /**
   * @returns {string}
   **/
  get title() {
    return 'PROGRESS';
  }

  /**
   * @returns {string}
   **/
  get percent() {
    const number = this.current / this.total * 100;
    const persent = isNaN(number) || !isFinite(number) ? '0' : number.toFixed(0);
    return `${persent}%`;
  }

  /**
   * @returns {number}
   **/
  get #speed() {
    const elapsed = Date.now() - this.last;
    const speed = this.batch / elapsed * 1000;

    return isNaN(speed) || !isFinite(speed) ? 0 : speed;
  }

  /**
   * @returns {string}
   **/
  get speed() {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let speed = this.#speed;
    let unit = 0;

    while (speed > 1024 && unit < units.length) {
      speed /= 1024;
      unit++;
    }

    const number = speed.toFixed(1).padStart(4, ' ');
    return `${number}${units[unit]}/s`;
  }

  /**
   * @returns {string}
   **/
  get eta() {
    const units = ['s', 'm', 'h', 'd'];
    const remaining = this.total - this.current;
    let eta = remaining / this.#speed;
    let unit = 0;

    if (isNaN(eta) || !isFinite(eta))
      return 'ETA: --';

    while (eta > 60 && unit < units.length) {
      eta /= 60;
      unit++;
    }

    const unit1 = units[unit];
    const unit2 = units[unit - 1];

    const integer = Math.floor(eta);
    const decimal = Math.floor((eta - integer) * 10);

    if (decimal === 0 || unit === 0)
      return `ETA: ${integer}${unit1}`;
    return `ETA: ${integer}${unit1}${decimal}${unit2}`;
  }

  /**
   * @param {number} bytes
   **/
  receive(bytes) {
    this.batch += bytes;

    const now = Date.now();
    const trueCurrent = this.current + this.batch;
    if (now - this.last < 250 && trueCurrent < this.total)
      return;

    this.current = Math.min(trueCurrent, this.total);
    this.render();

    // reset the batch
    this.batch = 0;
    this.last = now;
  }

  get placeholder() {
    return '';
  }

  render() {
    if (this.current >= this.total && !this.keep) {
      this.tty.clearLine(0);
      this.tty.cursorTo(0);
      return;
    }

    const layouts = [
      ['title', 'percent', 'blank', 'speed', 'eta', 'placeholder'],
      ['percent', 'blank', 'speed', 'eta', 'placeholder'],
      ['percent', 'speed', 'eta', 'placeholder'],
      ['percent', 'eta', 'placeholder'],
    ];
    const padding = ' '.repeat(2);
    let cursor = 0;
    let freezeCursor = false;

    // find the best layout
    let layout = layouts.find((layout) => {
      let width = 0;
      for (const key of layout)
        width += PADSIZES[key] + padding.length;
      return width <= this.width;
    });

    // fallback to the last layout
    if (!layout)
      layout = layouts[layouts.length - 1];

    const parts = [];
    const padchars = (layout.length - 1) * padding.length;

    // get the total width of the parts
    let width = 0;
    for (const key of layout)
      width += PADSIZES[key];
    const fillWidth = this.width - width - padchars;

    // render the parts
    for (let i = 0; i < layout.length; i++) {
      const key = layout[i];
      let part;

      if (key === 'blank') {
        if (fillWidth < PADSIZES.progress)
          part = ' '.repeat(fillWidth);
        else {
          const percent = this.current / this.total;
          const completed = Math.floor(percent * fillWidth);
          const remaining = fillWidth - completed;

          const completedBar = BAR.repeat(completed);
          const remainingBar = BAR.repeat(remaining);

          part = `${GREEN}${completedBar}${RED}${remainingBar}${RESET}`;
          cursor += completed;
          freezeCursor = true;
        }
      }
      else {
        const direct = PADDIRECT[key];
        const pad = direct === 'left'
          ? String.prototype.padStart
          : String.prototype.padEnd;
        part = pad.call(this[key], PADSIZES[key]);
      }

      parts.push(part);
      if (i < layout.length - 1 && !freezeCursor)
        cursor += part.length + padding.length;
    }

    this.tty.clearLine(0);
    this.tty.cursorTo(0);

    this.tty.write(parts.join(padding));
    if (this.keep && this.current >= this.total)
      this.tty.write('\n');
    else
      this.tty.cursorTo(cursor);
  }
}

// forground colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const BAR = '━';

const PADSIZES = {
  title: 9,
  percent: 4,
  progress: 20,
  speed: 10,
  eta: 10,
  blank: 0,
  placeholder: 2,
};

const PADDIRECT = {
  title: 'right',
  percent: 'left',
  speed: 'left',
  eta: 'left',
};
