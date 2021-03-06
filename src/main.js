Object.assign(extension, {
  init() {
    if (!/^(www|encrypted)\.google\./.test(window.location.hostname)) {
      return;
    }
    const loadOptions = this.options.load();
    // Don't initialize results navigation on image search, since it doesn't work
    // there.
    if (!/[?&]tbm=isch(&|$)/.test(location.search)) {
      // This file is loaded only after the DOM is ready, so no need to wait for
      // DOMContentLoaded.
      loadOptions.then(() => this.initResultsNavigation());
    }
    loadOptions.then(() => this.initCommonGoogleSearchNavigation());
  },

  changeTools(period) {
    // Save current period and sort.
    const res = /&(tbs=qdr:.)(,sbd:.)?/.exec(location.href)
    const currPeriod = (res && res[1]) || ''
    const currSort = (res && res[2]) || ''
    // Remove old period and sort.
    const strippedHref = location.href.replace(/&tbs=qdr:.(,sbd:.)?/, '')
    if (period) {
      location.href = strippedHref + (period === 'a' ? '' : '&tbs=qdr:' + period + currSort)
    }
    else if (currPeriod) {
      // Can't apply sort when not using period.
      location.href = strippedHref + '&' + currPeriod + (currSort ? '' : ',sbd:1')
    }
  },

  initResultsNavigation() {
    const options = this.options.sync.values;
    const lastNavigation = this.options.local.values;
    const results = getGoogleSearchLinks();
    let isFirstNavigation = true;
    if (options.autoSelectFirst) {
      // Highlight the first result when the page is loaded.
      results.focus(0);
    }
    if (location.href === lastNavigation.lastQueryUrl) {
      isFirstNavigation = false;
      results.focus(lastNavigation.lastFocusedIndex);
    }
    this.register(options.nextKey, () => {
      if (!options.autoSelectFirst && isFirstNavigation) {
        results.focus(0);
        isFirstNavigation = false;
      }
      else {
        results.focusNext(options.wrapNavigation);
      }
    });
    this.register(options.previousKey, () => {
      if (!options.autoSelectFirst && isFirstNavigation) {
        results.focus(0);
        isFirstNavigation = false;
      }
      else {
        results.focusPrevious(options.wrapNavigation);
      }
    });
    this.register(options.navigateKey, () => {
      const link = results.items[results.focusedIndex];
      lastNavigation.lastQueryUrl = location.href;
      lastNavigation.lastFocusedIndex = results.focusedIndex;
      this.options.local.save();
      link.anchor.click();
    });
    this.register(options.navigateNewTabKey, () => {
      const link = results.items[results.focusedIndex];
      browser.runtime.sendMessage({type: 'tabsCreate', options: {url: link.anchor.href, active: true}});
    });
    this.register(options.navigateNewTabBackgroundKey, () => {
      const link = results.items[results.focusedIndex];
      browser.runtime.sendMessage({type: 'tabsCreate', options: {url: link.anchor.href, active: false}});
    });
    this.register(options.navigateShowAll, () => this.changeTools('a'));
    this.register(options.navigateShowHour, () => this.changeTools('h'));
    this.register(options.navigateShowDay, () => this.changeTools('d'));
    this.register(options.navigateShowWeek, () => this.changeTools('w'));
    this.register(options.navigateShowMonth, () => this.changeTools('m'));
    this.register(options.navigateShowYear, () => this.changeTools('y'));
    this.register(options.toggleSort, () => this.changeTools(null));
  },

  initCommonGoogleSearchNavigation() {
    const options = this.options.sync.values;
    this.register(options.focusSearchInput, () => {
      const searchInput = document.querySelector("#searchform input[name=q]");
      searchInput.focus();
      searchInput.select();
    });
    const tabs = [
      [options.navigateSearchTab, 'a.q.qs:not([href*="&tbm="]):not([href*="maps.google."])'],
      [options.navigateImagesTab, 'a.q.qs[href*="&tbm=isch"]'],
      [options.navigateVideosTab, 'a.q.qs[href*="&tbm=vid"]'],
      [options.navigateMapsTab, 'a.q.qs[href*="maps.google."]'],
      [options.navigateNewsTab, 'a.q.qs[href*="&tbm=nws"]'],
      [options.navigateShoppingTab, 'a.q.qs[href*="&tbm=shop"]'],
      [options.navigateBooksTab, 'a.q.qs[href*="&tbm=bks"]'],
      [options.navigateFlightsTab, 'a.q.qs[href*="&tbm=flm"]'],
      [options.navigateFinancialTab, 'a.q.qs[href*="&tbm=fin"]'],
      [options.navigatePreviousResultPage, "#pnprev"],
      [options.navigateNextResultPage, "#pnnext"]
    ];
    for (let i = 0; i < tabs.length; i++) {
      const tabCommand = tabs[i];
      this.register(tabCommand[0], () => {
        const node = document.querySelector(tabCommand[1]);
        if (node !== null) {
          location.href = node.href;
        }
      });
    }
  },

  register(shortcut, callback) {
    key(shortcut, function(event) {
      callback();
      if (event !== null) {
        event.stopPropagation();
        event.preventDefault();
      }
      return false;
    });
  }
});

/**
 * @param {...[Element[], function|null]} results The array of tuples.
 * Each tuple contains collection of the search results optionally accompanied
 * with their container selector.
 * @constructor
 */
function SearchResultCollection(...results) {
  /**
   * @type {SearchResult[]}
   */
  this.items = [];
  for (let i = 0; i < results.length; i++) {
    const params = results[i];
    const nodes = params[0];
    const containerSelector = params[1];
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j];
      this.items.push(new SearchResult(node, containerSelector));
    }
  }
  // need to sort items by their document position)
  this.items.sort((a, b) => {
    const position = a.anchor.compareDocumentPosition(b.anchor);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    } else {
      return 0;
    }
  });
  this.focusedIndex = 0;
  this.focus = function(index) {
    if (this.focusedIndex >= 0) {
      // ensure previous focused item
      this.items[this.focusedIndex] && this.items[this.focusedIndex].anchor.classList.remove('highlighted-search-result');
    }
    const newItem = this.items[index];

    // exit if no new item
    if(!newItem) {
      return this.focusedIndex = -1
    }
    newItem.anchor.classList.add('highlighted-search-result');
    newItem.anchor.focus();
    // ensure whole search result container is visible in the viewport, not only
    // the search result link
    const container = newItem.getContainer() || newItem.anchor;
    const containerBounds = container.getBoundingClientRect();
    // firefox displays tooltip at the bottom which obstructs the view
    // as a workaround ensure extra space from the bottom in the viewport
    // firefox detection (https://stackoverflow.com/a/7000222/2870889)
    const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
    // hardcoded height of the tooltip plus some margin
    const firefoxBottomDelta = 26;
    const bottomDelta = (isFirefox ? firefoxBottomDelta: 0);
    if (containerBounds.top < 0) {
      // scroll container to top
      container.scrollIntoView(true);
    }
    else if (containerBounds.bottom + bottomDelta > window.innerHeight) {
      // scroll container to bottom
      container.scrollIntoView(false);
      window.scrollBy(0, bottomDelta);
    }
    this.focusedIndex = index;
  };
  this.focusNext = function(shouldWrap) {
    let nextIndex = 0;
    if (this.focusedIndex < this.items.length - 1) {
      nextIndex = this.focusedIndex + 1;
    }
    else if (!shouldWrap) {
      nextIndex = this.focusedIndex;
    }
    this.focus(nextIndex);
  };
  this.focusPrevious = function(shouldWrap) {
    let previousIndex = this.items.length - 1;
    if (this.focusedIndex > 0) {
      previousIndex = this.focusedIndex - 1;
    }
    else if (!shouldWrap) {
      previousIndex = this.focusedIndex;
    }
    this.focus(previousIndex);
  }
}

/**
 * @param {Element} anchor
 * @param {function|null} containerSelector
 * @constructor
 */
function SearchResult(anchor, containerSelector) {
  this.anchor = anchor;
  this.getContainer = function() {
    if (!containerSelector) {
      return this.anchor;
    }

    return containerSelector(this.anchor);
  };
}

function getGoogleSearchLinks() {
  // the nodes are returned in the document order which is what we want
  return new SearchResultCollection(
    [document.querySelectorAll('#search .r > a:first-of-type'), (n) => n.parentElement.parentElement],
    [document.querySelectorAll('div.zjbNbe > a'), null],
    [document.querySelectorAll('div.eIuuYe a'), null], // shopping results
    [document.querySelectorAll('#pnprev, #pnnext'), null]
  );
}

extension.init();
