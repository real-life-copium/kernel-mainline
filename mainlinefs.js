// @ts-check

import ProgressBar from './progress.js';
import { load as cheerio } from 'cheerio';
import { posix } from 'path';
import fs from 'fs/promises';

export default class MainlineFs {
  /** @type {MainlineFsEntity} */
  #root;

  /** @type {MainlineFsEntity[]} */
  #routes;

  constructor() {
    this.#root = new MainlineFsEntity(MainlineFs.Endpoint, {
      name: 'root',
      folder: true,
      date: new Date(),
      size: '-',
      description: 'root',
    });

    this.#routes = [];
  }

  /**
   * @returns {string}
   **/
  get pwd() {
    return posix.join(...this.#routes.map(route => route.stats.name));
  }

  /**
   * @returns {MainlineFsEntity}
   **/
  get root() {
    return this.#root;
  }

  /**
   * @returns {MainlineFsEntity}
   **/
  get cwd() {
    if (this.#routes.length === 0)
      return this.#root;
    return this.#routes[this.#routes.length - 1];
  }

  /**
   * @param {string} path
   * @returns {Promise<MainlineFsEntity>}
   * @throws {Error}
   **/
  async entry(path) {
    path = posix.join(this.pwd, path);

    const routes = path.split('/').filter(route => route !== '');
    let next = this.#root;

    for (const route of routes) {
      await next.fetch();

      if (next.entries == null || !next.entries.has(route))
        throw new Error(`No such file or directory: ${route}`);

      if (!next.entries.has(route))
        throw new Error(`No such file or directory: ${route}`);

      // @ts-ignore - we already checked if the entry exists
      next = next.entries.get(route);
    }

    return next;
  }

  /**
   * @param {string} path
   * @returns {Promise<string>}
   * @throws {Error}
   **/
  async cd(path) {
    if (path.startsWith('/')) {
      this.#routes = [];
      return this.cd(path.slice(1));
    }

    if (path === '..') {
      this.#routes.pop();
      return this.pwd;
    }

    const routes = path.split('/').filter(route => route !== '');
    if (routes.length === 0)
      return this.pwd;

    if (routes.length === 1) {
      const entry = await this.entry(routes[0]);
      if (!entry.stats.folder)
        throw new Error('Not a directory');
      this.#routes.push(entry);
      return this.pwd;
    }

    for (const route of routes) {
      await this.cd(route);
    }

    return this.pwd;
  }

  /**
   * @returns {Promise<Stats[]>}
   **/
  async ls() {
    await this.cwd.fetch();
    return Array.from(this.cwd.entries.values()).map(entry => entry.stats);
  }
};

MainlineFs.Endpoint = 'https://kernel.ubuntu.com/~kernel-ppa/mainline/';

class MainlineFsEntity {
  /** @type {boolean} */
  #synced;

  /**
    * @param {string} url
    * @param {Stats} stats
    *
    * @typedef {object} Stats
    * @property {string} name
    * @property {Date} date
    * @property {string} size
    * @property {string} description
    * @property {boolean} folder
    **/
  constructor(url, stats) {
    this.url = url;
    this.stats = stats;

    /** @type {Map<string, MainlineFsEntity>} */
    this.entries = new Map();
    this.entries.set('.', this);

    this.#synced = !stats.folder;
  }

  async fetch() {
    if (this.#synced)
      return;

    this.entries = new Map();
    this.entries.set('.', this);

    const html = await fetch(this.url).then(res => res.text());
    const $ = cheerio(html);

    const rows = $('table').find('tr');
    rows.splice(0, 3); // remove header rows

    /**
     * @template T
     * @typedef {import('cheerio').Cheerio} Cheerio<T>
     *
     * @param {Cheerio<import('cheerio').Element>} $row
     * @returns {boolean | null}
     **/
    function isFolder($row) {
      const icon = $row.find('td:nth-child(1) img').attr('src');
      if (icon == null)
        return null;

      const regex = /^\/icons\/(\w+)\.gif$/;
      const match = icon.match(regex);
      if (match == null)
        return null;
      return match[1] === 'folder';
    }

    for (const row of rows) {
      const $row = $(row);
      const folder = isFolder($row);

      if (folder == null)
        continue;

      const $entry = $row.find('td:nth-child(2) a');
      const fullname = $entry.text().trim();
      const name = fullname.endsWith('/') ? fullname.slice(0, -1) : fullname;
      const href = posix.join(this.url, $entry.attr('href') || '');

      const $date = $row.find('td:nth-child(3)');
      const date = new Date($date.text());

      const size = $row.find('td:nth-child(4)').text().trim();
      const description = $row.find('td:nth-child(5)').text().trim();

      const stats = {
        name,
        date,
        size,
        description,
        folder,
      };

      const entry = new MainlineFsEntity(href, stats);
      this.entries.set(name, entry);
    }
  }

  /**
    * Download the entity to the destination directory.
    * If the entity is a folder, it will be downloaded recursively.
    * @param {string} destDir
    * @param {string | null} destName
    * @returns {Promise<string>}
    **/
  async download(destDir, destName=null) {
    await fs.mkdir(destDir, { recursive: true });
    const dest = posix.join(destDir, destName ?? this.stats.name);

    if (this.stats.folder) {
      await this.fetch();
      await fs.mkdir(dest, { recursive: true });

      for (const [name, entry] of this.entries) {
        if (name === '.')
          continue;
        await entry.download(dest);
      }

      return dest;
    }

    // download file and log progress
    process.stdout.write(`Downloading ${dest}, ${this.stats.size} bytes...\n`);

    const response = await fetch(this.url);
    const total = Number(response.headers.get('content-length'));

    if (response.body == null)
      throw new Error('Response body is null');

    const progress = new ProgressBar(total, false);
    const reader = response.body.getReader();
    const writer = await fs.open(dest, 'w');

    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;

      await writer.write(value);
      progress.receive(value.length);
    }

    await writer.close();
    return dest;
  }
}
