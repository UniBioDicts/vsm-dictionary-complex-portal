const Dictionary = require('vsm-dictionary');
const { getLastPartOfURL, fixedEncodeURIComponent,
  removeDuplicates, isJSONString } = require('./fun');

module.exports = class DictionaryComplexPortal extends Dictionary {

  constructor(options) {
    const opt = options || {};
    super(opt);

    // optimized mapping for curators
    this.optimap = (typeof opt.optimap === 'boolean')
      ? opt.optimap
      : true;

    // Complex Portal-specific parameters
    this.complexPortalDictID = 'https://www.ebi.ac.uk/complexportal';
    this.complexPortalFields = 'id,name,description,complex_systematic_name,complex_synonym,organism';
    this.ebiSearchRestURL = 'https://www.ebi.ac.uk/ebisearch/ws/rest/';
    this.ebiSearchDomain  = 'complex-portal';
    this.ebiSearchMaxPageSize = 100;
    this.ebiSearchMinStart    = 0;
    this.ebiSearchMaxStart    = 1000000;
    this.ebiSearchFormat  = opt.format || 'json';

    const baseURL = opt.baseURL || this.ebiSearchRestURL + this.ebiSearchDomain;

    this.perPageDefault = 50;

    // enable the console.log() usage
    this.enableLogging = opt.log || false;

    this.urlGetEntries = opt.urlGetEntries || baseURL + '/entry/$ids';
    this.urlGetMatches = opt.urlGetMatches || baseURL + '?query=$queryString';
  }

  getDictInfos(options, cb) {
    let res = {
      items: [
        {
          id: this.complexPortalDictID,
          abbrev: 'Complex Portal',
          name: 'Complex Portal'
        }
      ]
    };

    if (!this.hasProperFilterIDProperty(options)) {
      return cb(null, res);
    } else {
      return (options.filter.id.includes(this.complexPortalDictID))
        ? cb(null, res)
        : cb(null, { items: [] });
    }
  }

  getEntries(options, cb) {
    if (this.hasProperFilterDictIDProperty(options)
      && !options.filter.dictID.includes(this.complexPortalDictID)) {
      return cb(null, { items: [] });
    }

    const url = this.prepareEntrySearchURL(options);

    if (this.enableLogging)
      console.log('URL: ' + url);

    this.request(url, (err, res) => {
      if (err) return cb(err);
      let entryObjArray = this.mapComplexPortalResToEntryObj(res);

      // When requesting specific list of ids, do sorting and trimming
      let arr = entryObjArray;
      if (this.hasProperFilterIDProperty(options)) {
        arr = this.trimEntryObjArray(
          this.sortEntries(entryObjArray, options), options
        );
      }

      // z-prune results
      arr = Dictionary.zPropPrune(arr, options.z);

      cb(err, { items: arr });
    });
  }

  getEntryMatchesForString(str, options, cb) {
    if ((!str) || (str.trim() === '')) return cb(null, { items: [] });

    if (this.hasProperFilterDictIDProperty(options)
      && !options.filter.dictID.includes(this.complexPortalDictID)) {
      return cb(null, { items: [] });
    }

    const url = this.prepareMatchStringSearchURL(str, options);

    if (this.enableLogging)
      console.log('URL: ' + url);

    this.request(url, (err, res) => {
      if (err) return cb(err);
      let matchObjArray = this.mapComplexPortalResToMatchObj(res, str);

      // z-prune results
      let arr = Dictionary.zPropPrune(matchObjArray, options.z);

      cb(err, { items: arr });
    });
  }

  mapComplexPortalResToEntryObj(res) {
    return res.entries.map(entry => ({
      id: this.complexPortalDictID + '/complex/' + entry.fields.id[0],
      dictID: this.complexPortalDictID,
      descr: this.getDescr(entry.fields.id[0], entry.fields.organism,
        entry.fields.description),
      terms: this.buildTerms(entry.fields.name,
        entry.fields.complex_systematic_name, entry.fields.complex_synonym),
      z: {
        ...((entry.fields.organism.length !== 0)
          && {
            species: entry.fields.organism[0],
          }
        )
      }
    }));
  }

  mapComplexPortalResToMatchObj(res, str) {
    return res.entries.map(entry => {
      const mainTerm = this.getMainTerm(entry.fields.name,
        entry.fields.complex_systematic_name);
      return {
        id: this.complexPortalDictID + '/complex/' + entry.fields.id[0],
        dictID: this.complexPortalDictID,
        str: mainTerm,
        descr: this.getDescr(entry.fields.id[0], entry.fields.organism,
          entry.fields.description),
        type: mainTerm.startsWith(str) ? 'S' : 'T',
        terms: this.buildTerms(entry.fields.name,
          entry.fields.complex_systematic_name, entry.fields.complex_synonym),
        z: {
          ...((entry.fields.organism.length !== 0)
            && {
              species: entry.fields.organism[0],
            }
          )
        }
      };
    });
  }

  prepareEntrySearchURL(options) {
    let url = this.urlGetEntries;
    let idList = [];

    // remove empty space ids
    if (this.hasProperFilterIDProperty(options)) {
      idList = options.filter.id.filter(id => id.trim() !== '');
    }

    if (idList.length !== 0) {
      // specific IDs
      let complexPortalIDs = idList.map(id => getLastPartOfURL(id)).join();

      url = url.replace('$ids', complexPortalIDs) + '?fields='
        + fixedEncodeURIComponent(this.complexPortalFields);
    } else {
      // all IDs
      url = url
        .replace('/entry/$ids', '?query=domain_source:' + this.ebiSearchDomain)
        + '&fields=' + fixedEncodeURIComponent(this.complexPortalFields) + '&sort=id';

      // add size and start URL parameters
      let pageSize = this.perPageDefault;
      if (this.hasProperPerPageProperty(options)
        && options.perPage <= this.ebiSearchMaxPageSize
      ) {
        pageSize = options.perPage;
      }

      url += '&size=' + pageSize;

      if (this.hasProperPageProperty(options)) {
        if ((options.page - 1) * pageSize < this.ebiSearchMaxStart)
          url += '&start=' + (options.page - 1) * pageSize;
        else
          url += '&start=' + (this.ebiSearchMaxStart - 1);
      } else
        url += '&start=' + this.ebiSearchMinStart;
    }

    url += '&format=' + this.ebiSearchFormat;
    return url;
  }

  prepareMatchStringSearchURL(str, options) {
    let url = this.urlGetMatches
      .replace('$queryString', fixedEncodeURIComponent(str))
      + '&fields=' + fixedEncodeURIComponent(this.complexPortalFields);

    // add size and start URL parameters
    let pageSize = this.perPageDefault;
    if (this.hasProperPerPageProperty(options)
      && options.perPage <= this.ebiSearchMaxPageSize
    ) {
      pageSize = options.perPage;
    }

    url += '&size=' + pageSize;

    if (this.hasProperPageProperty(options)) {
      if ((options.page - 1) * pageSize < this.ebiSearchMaxStart)
        url += '&start=' + (options.page - 1) * pageSize;
      else
        url += '&start=' + (this.ebiSearchMaxStart - 1);
    } else
      url += '&start=' + this.ebiSearchMinStart;

    url += '&format=' + this.ebiSearchFormat;
    return url;
  }

  buildTerms(name, systematicName, complexSynonyms) {
    let res = [];

    let mainTerm = this.getMainTerm(name, systematicName);
    res.push({ str: mainTerm });

    let synonyms = removeDuplicates(systematicName.concat(complexSynonyms));
    synonyms = synonyms.filter(syn => syn !== mainTerm);

    for (let synonym of synonyms) {
      res.push({ str: synonym });
    }

    return res;
  }

  getMainTerm(name, systematicName) {
    if (name.length !== 0)
      return name[0];
    else // should never happen
      return systematicName[0];
  }

  getDescr(id, organism, description) {
    const descr = (description.length !== 0) ? description[0] : '';
    if (this.optimap) {
      const species = (organism.length !== 0) ? ', '.concat(organism[0]) : '';
      return (descr === '')
        ? id.concat(species)
        : id.concat(species, ', ', descr);
    } else {
      return descr;
    }
  }

  sortEntries(arr, options) {
    if (!this.hasProperEntrySortProperty(options)
      || options.sort === 'id'
      || options.sort === 'dictID')
      return arr.sort((a, b) =>
        this.str_cmp(a.id, b.id));
    else if (options.sort === 'str')
      return arr.sort((a, b) =>
        this.str_cmp(a.terms[0].str, b.terms[0].str)
        || this.str_cmp(a.id, b.id));
  }

  str_cmp(a, b, caseMatters = false) {
    if (!caseMatters) {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }
    return a < b
      ? -1
      : a > b
        ? 1
        : 0;
  }

  trimEntryObjArray(arr, options) {
    let numOfResults = arr.length;
    let page = this.hasProperPageProperty(options)
      ? options.page
      : 1;
    let pageSize = this.hasProperPerPageProperty(options)
      ? options.perPage
      : this.perPageDefault;

    return arr.slice(
      ((page - 1) * pageSize),
      Math.min(page * pageSize, numOfResults)
    );
  }

  hasProperFilterDictIDProperty(options) {
    return options.hasOwnProperty('filter')
      && options.filter.hasOwnProperty('dictID')
      && Array.isArray(options.filter.dictID)
      && options.filter.dictID.length !== 0;
  }

  hasProperFilterIDProperty(options) {
    return options.hasOwnProperty('filter')
      && options.filter.hasOwnProperty('id')
      && Array.isArray(options.filter.id)
      && options.filter.id.length !== 0;
  }

  hasProperPageProperty(options) {
    return options.hasOwnProperty('page')
      && Number.isInteger(options.page)
      && options.page >= 1;
  }

  hasProperPerPageProperty(options) {
    return options.hasOwnProperty('perPage')
      && Number.isInteger(options.perPage)
      && options.perPage >= 1;
  }

  hasProperEntrySortProperty(options) {
    return options.hasOwnProperty('sort')
      && typeof options.sort === 'string'
      && (options.sort === 'dictID'
        || options.sort === 'id'
        || options.sort === 'str'
      );
  }

  request(url, cb) {
    const req = this.getReqObj();
    req.onreadystatechange = function () {
      if (req.readyState === 4) {
        if (req.status !== 200) {
          let response = req.responseText;
          isJSONString(response)
            ? cb(JSON.parse(response))
            : cb(JSON.parse('{ "status": ' + req.status
            + ', "error": ' + JSON.stringify(response) + '}'));
        }
        else {
          try {
            const response = JSON.parse(req.responseText);
            cb(null, response);
          } catch (err) {
            cb(err);
          }
        }
      }
    };
    req.open('GET', url, true);
    req.send();
  }

  getReqObj() {
    return new (typeof XMLHttpRequest !== 'undefined'
      ? XMLHttpRequest // In browser
      : require('xmlhttprequest').XMLHttpRequest  // In Node.js
    )();
  }

};
