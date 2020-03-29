var Case = require("./models/case");
var Store = require("./models/store");
var ObjectId = require("mongoose").Types.ObjectId;
var bodyParser = require("body-parser");
const Hashids = require("hashids/cjs");
const connectEnsureLogin = require("connect-ensure-login");
var jsonParser = bodyParser.json({
  limit: "50mb"
});
const hashids = new Hashids("pando tracker", 20);

module.exports = function(app, passport) {
  app.get("/api/v1/test", function(req, res) {
    console.log("[Router] Test Endpoint");
    /* Test compare hashed GPS
    var lat_test = 38.642872;
    var lng_test = 149.407372;
    var lat_compare = 38.652872;
    var lng_compare = 149.407372;
    let hashgps = hashids.encode([parseInt(lat_test * 1000000), parseInt(lng_test * 1000000)]);
    let hashgps_compare = hashids.encode([parseInt(lat_compare * 1000000), parseInt(lng_compare * 1000000)]);
    console.log("Lat: " + lat_test + " Lng: " + lng_test);
    console.log("Hash: " + hashgps + " HashCompare: " + hashgps_compare + " Compare: ");
    let hashgpsdecode = hashids.decode(hashgps);
    console.log("Hash Decode: " + hashgpsdecode[0] / 1000000 + "  " + hashgpsdecode[1] / 1000000);
    */
    var ids = hashids.decodeHex(req.query.id);
    console.log(ids);
    res.send({ success: true, _error: null, data: ids });
  });

  /*Upload GPS Data with timestamps and create a new case with unique ID for this dataset*/
  app.post("/api/v1/upload", jsonParser, function(req, res) {
    var d = new Date();
    if (req.query.username) var username = req.query.username;
    else return res.send({ success: false, _error: "No Username set" });
    if (req.query.password) var password = req.query.password;
    else return res.send({ success: false, _error: "No Password set" });
    let btId = req.query.btId ? req.query.btId : undefined;
    Case.findOne({ username: username }, function(err, result) {
      if (result) return res.send({ success: false, _error: "username already given. Please use another" });
      console.log("[Router] Case Upload - Points: " + req.body.data.length);
      var newCase = new Case({
        status: 0,
        btId: btId,
        serverTime: new Date(),
        username: username,
        privacyLevel: 0
      });
      newCase.setPassword(password, function() {
        newCase.save(function(err) {
          if (err) {
            console.log("[Router] Save Case Error: " + err);
            return res.status(403).send({ success: false, _error: err });
          } else {
            const stores_array = [];
            for (var k in req.body.data) {
              let coordinates =
                req.body.data[k].lat && req.body.data[k].lng
                  ? { coordinates: [req.body.data[k].lng, req.body.data[k].lat], type: "point" }
                  : undefined;
              let speed = req.body.data[k].speed ? req.body.data[k].speed : undefined;
              let type = req.body.data[k].type ? req.body.data[k].type : "point";
              let geocode = req.body.data[k].geocode ? req.body.data[k].geocode[0] : undefined;
              let btId = req.body.data[k].btId ? req.body.data[k].btId : undefined;
              var newstore = new Store({
                type: type,
                caseId: ObjectId(newCase._id),
                location: coordinates,
                btId: btId,
                time: new Date(req.body.data[k].time),
                speed: speed,
                geocode: geocode
              });
              stores_array.push(newstore);
            }
            Store.insertMany(stores_array, function(err, result) {
              if (err) {
                if (err.code == "16755") {
                  return res.send({
                    success: false,
                    _error: "False Geocode in uploaded JSON, Check coordinates."
                  });
                }
                throw err;
              }
              passport.authenticate("local")(req, res, function() {
                var f = new Date();
                var diff = Math.abs(d - f);
                let caseId_hash = hashids.encodeHex(ObjectId(newCase._id).toString());
                res.send({ success: true, _error: null, count: req.body.data.length, timeMS: diff, caseId: caseId_hash, btId: newCase.btId });
              });
            });
          }
        });
      });
    });
  });

  /*Update an existing Case and add new Stores*/
  app.post("/api/v1/update", jsonParser, function(req, res) {});

  //ToDo: Select Cache if build
  //ToDo: GZIP Option for Download
  /*Download all Userdata uploaded with GPS Data and Timestamp*/
  app.get("/api/v1/download", function(req, res) {
    if (req.query.startId && ObjectId.isValid(req.query.startId) != true) {
      return res.status(403).send({
        success: false,
        _error: "Error: ObjectID emty format. Argument passed in must be a single String of 12 bytes or a string of 24 hex characters."
      });
    }
    var limit = 5000;
    var d = new Date();
    var search = {};
    if (req.query.onlyVerified) search = { "caseId.status": 1 };
    if (req.query.startId) search["_id"] = { $gte: ObjectId(req.query.startId) };
    Store.aggregate(
      [
        {
          $lookup: {
            from: "cases",
            localField: "caseId",
            foreignField: "_id",
            as: "caseId"
          }
        },
        { $unwind: "$caseId" },
        { $sort: { _id: 1 } },
        { $match: search },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            lat: { $ifNull: [{ $arrayElemAt: ["$location.coordinates", 1] }, "$lat"] },
            lng: { $ifNull: [{ $arrayElemAt: ["$location.coordinates", 0] }, "$lng"] },
            speed: 1,
            time: 1,
            btId: 1
          }
        }
      ],
      function(err, result) {
        if (result.length <= 0) return res.send({ success: false, _error: "No Stores found" });
        var latest = result.slice(-1).pop()._id;
        var is_update = result.length < limit;
        var f = new Date();
        var diff = Math.abs(d - f);
        console.log("[Router] Case Download ID: " + req.query.startId + " Points: " + result.length + " Verified: " + req.query.onlyVerified);
        res.send({ success: true, _error: null, count: result.length, timeMS: diff, latestId: latest, isNewest: is_update, data: result });
      }
    );
  });

  //ToDo: Change from GPS/TIME Match to Passwort auth
  /*Get Case Data from your case */
  app.get("/api/v1/case", connectEnsureLogin.ensureLoggedIn("/api/v1/login"), function(req, res) {
    console.log("[Router] Get Case: " + req.user._id);
    var d = new Date();
    var n = d.toLocaleTimeString();
    Case.find({ _id: { $in: req.user._id } }, {}, function(err, result) {
      var f = new Date();
      var diff = Math.abs(d - f);
      var ret_value = {};
      var hash_id = hashids.encodeHex(ObjectId(result._id).toString());

      ret_value["_id"] = hash_id;
      ret_value["status"] = result[0].status;
      ret_value["serverTime"] = result[0].serverTime;
      ret_value["username"] = result[0].username;
      ret_value["contactInfo"] = result[0].contactInfo;
      ret_value["btId"] = result[0].btId;

      res.send({ success: true, _error: null, timeMS: diff, data: ret_value });
    });
  });

  /*Del the Case via PW Auth*/
  app.get("/api/v1/case/del", connectEnsureLogin.ensureLoggedIn("/api/v1/login"), function(req, res) {
    if (ObjectId.isValid(req.user._id) != true) {
      return res.status(403).send({
        success: false,
        _error: "Error: ObjectID emty format. Argument passed in must be a single String of 12 bytes or a string of 24 hex characters."
      });
    }
    var d = new Date();
    var search_cases = {};
    var search_stores = {};
    if (req.user._id) search_cases["_id"] = ObjectId(req.user._id);
    if (req.user._id) search_stores["caseId"] = ObjectId(req.user._id);
    console.log("[Router] Del Case - ID:" + search_cases._id);
    Case.findOne(search_cases, {}, function(err, result) {
      if (err) throw err;
      if (result) {
        Case.deleteOne(search_cases, function(err, result) {
          if (err) throw err;
          Store.deleteMany(search_stores, {}, function(err, result) {
            if (err) throw err;
            var f = new Date();
            var diff = Math.abs(d - f);
            res.send({ success: true, _error: null, timeMS: diff, data: result });
          });
        });
      } else {
        return res.status(403).send({ success: false, _error: "No Case found to Delete" });
      }
    });
  });

  /*Edit your Case via PW Auth*/
  app.get("/api/v1/case/edit", connectEnsureLogin.ensureLoggedIn("/api/v1/login"), function(req, res) {
    if (ObjectId.isValid(req.user._id) != true) {
      return res.status(403).send({
        success: false,
        _error: "Error: ObjectID emty format. Argument passed in must be a single String of 12 bytes or a string of 24 hex characters."
      });
    }
    console.log("[Router] Edit Case: " + req.user._id + "New Data:");
    var d = new Date();
    var search_cases = {};
    var search_stores = {};
    var set_status;
    var bt_id;
    var contactInfo = [];
    if (req.user._id) search_cases["_id"] = ObjectId(req.user._id);
    if (req.user._id) search_stores["caseId"] = ObjectId(req.user._id);
    if (req.query.status) set_status = req.query.status;
    if (req.query.btId) bt_id = req.query.btId;
    if (req.query.phone) contactInfo.phone = req.query.phone;
    if (req.query.info) contactInfo.info = req.query.info;
    if (req.query.text) contactInfo.text = req.query.text;
    if (req.query.privacyLevel) var privacyLevel = req.query.privacyLevel;
    console.log("[Router] Edit Case - ID:" + search_cases._id);
    Case.findOne(search_cases, {}, function(err, result) {
      if (err) throw err;
      if (result) {
        if (set_status) result.status = set_status;
        if (bt_id) result.btId = bt_id;
        if (privacyLevel) result.privacyLevel = privacyLevel;
        if (contactInfo.phone) result.contactInfo.phone = contactInfo.phone;
        if (contactInfo.info) result.contactInfo.info = contactInfo.info;
        if (contactInfo.text) result.contactInfo.text = contactInfo.text;
        console.log(result);
        result.save(search_cases, function(err, result) {
          if (err) throw err;
          var f = new Date();
          var diff = Math.abs(d - f);
          res.send({ success: true, _error: null, timeMS: diff, data: result });
        });
      } else {
        return res.status(403).send({ success: false, _error: "No Case found to Delete" });
      }
    });
  });

  /*Build the region cache, needs to trigger via cron*/
  app.get("/api/v1/cacheupdate", function(req, res) {
    console.log("[Router] Update Cache DB");
    var d = new Date();
    Store.aggregate(
      [
        {
          $lookup: {
            from: "cases",
            localField: "caseId",
            foreignField: "_id",
            as: "caseId"
          }
        },
        { $unwind: "$caseId" },
        { $match: { "caseId.status": { $gte: 1 } } },
        {
          $project: {
            _id: 1,
            caseId: 1,
            lat: 1,
            coordinates: 1,
            speed: 1,
            time: 1
          }
        },
        {
          $merge: {
            into: "c",
            on: "_id",
            whenMatched: "replace",
            whenNotMatched: "insert"
          }
        }
      ],
      function(err, result) {
        var f = new Date();
        var diff = Math.abs(d - f);
        res.send({ success: true, _error: null, timeMS: diff, data: result });
      }
    );
  });

  /*login to your case ID*/
  app.post("/api/v1/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user)
        return res.send({
          success: false,
          _error: "User does not exist or Passwort false"
        });

      req.logIn(user, function(err) {
        if (err) return next(err);
        console.log("[Router] User Login");
        return res.send({ success: true, _error: null, data: "Login Success" });
      });
    })(req, res, next);
  });

  /*Redirect for failed or no auth logins*/
  app.get("/api/v1/login", (req, res, next) => {
    if (!req.user) {
      return res.send({
        success: false,
        _error: "You are not logged in. Please try again!"
      });
    } else {
      return res.send({
        success: true,
        _error: null,
        data: "You are logged in"
      });
    }
  });

  app.get("/api/v1/logout", function(req, res) {
    req.logout();
    return res.send({ success: true, _error: null, data: "Logout Success" });
  });

  app.get("/api/v1/logout", function(req, res) {
    req.logout();
    return res.send({ success: true, _error: null, data: "Logout Success" });
  });

  /*match gps from json upload with database and return all time/location matches with some info about risk*/
  //ToDo: Need to handle Array maybe?
  //Should return status or complete match. depends on privacy settings of uploader

  app.get("/api/v1/data/match", function(req, res) {
    if (req.query.lat) var lat = req.query.lat;
    else return res.send({ success: false, _error: "Please input at least Lat and Lng" });
    if (req.query.lng) var lng = req.query.lng;
    else return res.send({ success: false, _error: "Please input at least Lat and Lng" });
    if (req.query.time) var time = { time: new Date(req.query.time) };
    else var time = {};

    console.log("[Router] Waypoint match Request Lat:" + lat + " Lng:" + lng);

    Store.aggregate(
      [
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [parseFloat(lng), parseFloat(lat)]
            },
            distanceField: "distance",
            maxDistance: 200,
            spherical: true
          }
        },
        { $match: time },
        {
          $lookup: {
            from: "cases",
            localField: "caseId",
            foreignField: "_id",
            as: "caseId"
          }
        },
        { $unwind: "$caseId" },
        {
          $project: {
            _id: 0,
            lat: { $arrayElemAt: ["$location.coordinates", 1] },
            lng: { $arrayElemAt: ["$location.coordinates", 0] },
            speed: 1,
            time: 1,
            status: "$caseId.status",
            privacyLevel: "$caseId.privacyLevel"
          }
        }
      ],
      function(err, result) {
        let matchCount = result.length;
        if (matchCount == 0) return res.send({ success: true, _error: null, data: { isMatch: 0, matchCount: 0 } });
        for (var k in result) {
          if (result[k].privacyLevel === 0) {
            result[k] = {};
            result[k].privacyLevel = 0;
            result[k].isMatch = 1;
          }
        }
        console.log("[Router] Waypoint match " + matchCount + " Results");
        return res.send({ success: true, _error: null, matchCount: matchCount, data: result });
      }
    );
  });
};
