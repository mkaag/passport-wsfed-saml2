var util      = require('util');
var xmldom    = require('xmldom');
var jwt       = require('jsonwebtoken');
var Strategy  = require('passport-strategy');
var saml      = require('./saml');
var wsfed     = require('./wsfederation');
var samlp     = require('./samlp');
 
function WsFedSaml2Strategy (options, verify) {
  if (typeof options === 'function') {
    verify = options;
    options = {};
  }
 
  this.options = options || {};
  this.options.protocol = this.options.protocol || 'wsfed';
 
  if (!verify) {
    throw new Error('this strategy requires a verify function');
  }
 
  this.name = 'wsfed-saml2';
 
  Strategy.call(this);
 
  this._verify = verify;
 
  // MKA 2016-04-05
  if (this.options.passReqToCallback) {
                  this.passReqToCallback = this.options.passReqToCallback;
  } else {
                  this.passReqToCallback = false;
  }
 
  if (!this.options.jwt) {
    this._saml = new saml.SAML(this.options);
    this._samlp =  new samlp(this.options, this._saml);
  } else {
    this._jwt = this.options.jwt;
  }
 
  this._wsfed =  new wsfed(options.realm, options.homeRealm, options.identityProviderUrl, options.wreply);
}
 
util.inherits(WsFedSaml2Strategy, Strategy);
 
WsFedSaml2Strategy.prototype._authenticate_saml = function (req) {
  var self = this;
 
 
  if (req.body.wresult.indexOf('<') === -1) {
    return self.fail('wresult should be a valid xml', 400);
  }
 
  var token = self._wsfed.extractToken(req);
  if (!token) {
    return self.fail('missing RequestedSecurityToken element', 400);
  }
 
  self._saml.validateSamlAssertion(token, function (err, profile) {
    if (err) {
      return self.error(err);
    }
 
    var verified = function (err, user, info) {
      if (err) {
        return self.error(err);
      }
 
      if (!user) {
        return self.fail(info);
      }
 
      self.success(user, info);
    };
 
    // self._verify(profile, verified);
                // MKA 2016-04-05
                if (self.passReqToCallback) {
                                self._verify(req, profile, verified);
                } else {
                                self._verify(profile, verified);
 
                }
  });
};
 
WsFedSaml2Strategy.prototype._authenticate_jwt = function (req) {
  var self = this;
  var token = req.body.wresult;
 
  jwt.verify(token, this.options.cert, this._jwt, function (err, profile) {
    if (err) {
      return self.error(err);
    }
 
    var verified = function (err, user, info) {
      if (err) {
        return self.error(err);
      }
 
      if (!user) {
        return self.fail(info);
      }
 
      self.success(user, info);
    };
 
    // self._verify(profile, verified);
                // MKA 2016-04-05
                if (self.passReqToCallback) {
                                self._verify(req, profile, verified);
                } else {
                                self._verify(profile, verified);
 
                }
  });
};
 
WsFedSaml2Strategy.prototype.authenticate = function (req, opts) {
  var self = this;
  var protocol = opts.protocol || this.options.protocol;
  var authzParams = this.authorizationParams(opts);
 
  function executeWsfed(req) {
    if (req.body && req.method === 'POST' && req.body.wresult) {
      // We have a response, get the user identity out of it
      if (self._jwt) {
        self._authenticate_jwt(req);
      } else {
        self._authenticate_saml(req);
      }
    } else {
      // Initiate new ws-fed authentication request
 
      var idpUrl = self._wsfed.getRequestSecurityTokenUrl(authzParams);
      self.redirect(idpUrl);
    }
  }
 
  function executeSamlp(req) {
    if (req.body && req.method === 'POST' && req.body.SAMLResponse) {
      var samlResponse = self._samlp.decodeResponse(req);
      if (samlResponse.indexOf('<') === -1) {
        return self.fail('SAMLResponse should be a valid xml', 400);
      }
 
      // We have a response, get the user identity out of it
      var samlResponseDom = new xmldom.DOMParser().parseFromString(samlResponse);
      self._samlp.validateSamlResponse(samlResponseDom, function (err, profile) {
        if (err) return self.fail(err, err.status || 400);
 
 
        var verified = function (err, user, info) {
          if (err) return self.error(err);
 
          if (!user) return self.fail(info);
 
          self.success(user, info);
        };
 
        // self._verify(profile, verified);
                                // MKA 2016-04-05
                                if (self.passReqToCallback) {
                                                self._verify(req, profile, verified);
                                } else {
                                                self._verify(profile, verified);
 
                                }
      });
    } else {
      // Initiate new samlp authentication request
      if (self.options.protocolBinding === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST') {
        self._samlp.getSamlRequestForm(authzParams, function (err, form) {
          if (err) return self.error(err);
          var res = req.res;
          res.set('Content-Type', 'text/html');
          res.send(form);
        });
      }
      else {
        self._samlp.getSamlRequestUrl(authzParams, function (err, url) {
          if (err) return self.error(err);
 
          self.redirect(url);
 
        });
      }
    }
  }
 
  switch (protocol) {
  case 'wsfed':
    executeWsfed(req, this.options);
    break;
  case 'samlp':
    executeSamlp(req, this.options);
    break;
  default:
    throw new Error('not supported protocol: ' + protocol);
  }
 
 
};
 
WsFedSaml2Strategy.prototype.authorizationParams = function(options) {
  return options;
};
 
module.exports = WsFedSaml2Strategy;
