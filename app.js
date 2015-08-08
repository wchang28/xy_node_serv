var http = require('http');
var https = require('https');
var basicAuth = require('basic-auth-connect');
var fs = require('fs');
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var kill = require('tree-kill');

var DEFAULT_SERVICE_NAME = "XY Node.js Service";

if (process.argv.length < 3) {
	console.error('config file is not optional');
	process.exit(1);
}
var config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
//console.log(JSON.stringify(config));
var consoleConfig = config["console"];
if (!consoleConfig) {
	console.error('missing "console" config');
	process.exit(1);
}
var protocolsConfig = consoleConfig["protocols"];
if (!protocolsConfig) {
	console.error('missing "protocols" config');
	process.exit(1);
}

var serviceConfig = config["service"];
if (!serviceConfig) {
	console.error('missing "service" config');
	process.exit(1);
}

if (!serviceConfig["cmd"] || serviceConfig["cmd"].length == 0) {
	console.error('invalid service command');
	process.exit(1);
}

if (!serviceConfig["homeRoute"] || serviceConfig["homeRoute"].length == 0) {
	console.error('invalid service home route');
	process.exit(1);
}

var serviceName = (serviceConfig.name ? serviceConfig.name : DEFAULT_SERVICE_NAME);
var runAtStart = (typeof serviceConfig.runAtStart === 'boolean' ? serviceConfig.runAtStart : true);
var restartWhenTerminatedAbortnormally = (typeof serviceConfig.restartWhenTerminatedAbortnormally === 'boolean'? erviceConfig.restartWhenTerminatedAbortnormally : true);

app.use(bodyParser.json());

var basicAuthConfig = consoleConfig["basic-auth"];
if (basicAuthConfig) {
	app.use(basicAuth(function(user, pass){
		if (!user || user.length == 0|| !pass || pass.length == 0) return false;
		if (basicAuthConfig[user] && pass === basicAuthConfig[user])
			return true;
		else
			return false;
	}));
}
	
app.use(function timeLog(req, res, next) {
	console.log('an incomming request @ ./. Time: ', Date.now());
	res.header("Access-Control-Allow-Origin", "*");
	next();
});

var childPid = null;	// child process's process id

function getStatusObject(onDone) {
	var state = (childPid ? "STARTED" : "STOPPED");
	var now = new Date();
	var ret = {"name": serviceName, "pid": childPid, "state": state, "time": now.toString()};
	onDone(ret);
}

// TODO:
function sendNotification(statusObj, onDone) {
	console.log("sending: " + JSON.stringify(statusObj) + "...");
	if (typeof onDone === 'function') onDone(null);
}

function onSendNotificationDone(err) {
	if (err) console.error('!!! error sending notification: ' + err.toString());
	else console.log('notification sent successfully');	
}

// Ctrl+C interrupt
process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
	if (childPid) {
		console.log('killing child process ' + childPid);
		kill(childPid, 'SIGKILL', function(err) {
			console.log('child process fully killed');
			process.exit();
		});
	}
	else
		process.exit();
});

function runChildProcess(cmd) {
	console.log('launching child process... cmd=' + cmd);
	var exec = require('child_process').exec;
	var child = exec(cmd, {});
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.on('exit', function(code) {
		var now = new Date();
		console.log('child process exits with code=' + code + ", time=" + now.toString());
		childPid = null;
		var abnormalTermination = (code == null);
		if (abnormalTermination) console.error('!!! child process terminated abnormally :-( @ ' + now.toString());
		getStatusObject(function(statusObj) {
			statusObj.exitStatus = {"code": code, "abnormalTermination": abnormalTermination};
			sendNotification(statusObj, onSendNotificationDone);
			if (abnormalTermination && restartWhenTerminatedAbortnormally) runChildProcess(cmd);
		});
	});
	childPid = child.pid;
	console.log('new child process pid=' + childPid + ", time=" + new Date().toString());
	getStatusObject(function(statusObj) {sendNotification(statusObj, onSendNotificationDone);});
}

function killChildProcess(onDone) {
	if (childPid) {
		console.log('killing child process ' + childPid);
		kill(childPid, 'SIGKILL', function(err) {
			console.log('old child process fully killed');
			if (typeof onDone === 'function') onDone();
		});
	}
	else {
		if (typeof onDone === 'function') onDone();
	}
}

function restartChildProcess(cmd, onDone) {
	console.log('restarting child process. current pid=' +childPid);
	if (childPid) {
		console.log('killing child process ' + childPid);
		kill(childPid, 'SIGKILL', function(err) {
			console.log('old child process fully killed');
			runChildProcess(cmd);
			if (typeof onDone === 'function') onDone(childPid);
		});
	}
	else {
		runChildProcess(cmd);
		if (typeof onDone === 'function') onDone(childPid);
	}
}

// set up the service home route
//////////////////////////////////////////////////////////////////////////////////////
var router = express.Router();
router.use(function timeLog(req, res, next) {
	console.log('an incomming request @ ' + serviceConfig["homeRoute"] + '. Time: ', Date.now()); 
 	next(); 
}); 
router.get('/hello', function(request, result) {
	getStatusObject(function(statusObj) {result.json(statusObj);});
});
router.get('/start', function(request, result) {
	if (!childPid) runChildProcess(serviceConfig["cmd"]);
	getStatusObject(function(statusObj) {result.json(statusObj);});
});
router.get('/stop', function(request, result) {
	killChildProcess(function() {
		getStatusObject(function(statusObj) {result.json(statusObj);});
	});
});
router.get('/restart', function(request, result) {
	restartChildProcess(serviceConfig["cmd"], function(pid) {
		getStatusObject(function(statusObj) {result.json(statusObj);});
	});
});
router.all('/', function(request, result) {
	result.set('Content-Type', 'application/json');
	result.json({"exception":"bad request"});
});

app.use(serviceConfig["homeRoute"], router);
//////////////////////////////////////////////////////////////////////////////////////

// HTTP
//////////////////////////////////////////////////////////////////////////////////////
var httpServer = null;
if (protocolsConfig["http"]) {
	var httpConfig = protocolsConfig["http"];
	if (!httpConfig.port) {
		console.error('no http port specified');
		process.exit(1);
	}
	var httpServer = http.createServer(app);
	httpServer.listen(httpConfig.port, function() {
		var host = httpServer.address().address;
		var port = httpServer.address().port;
		console.log('console listening at %s://%s:%s', 'http', host, port);
	});
}
//////////////////////////////////////////////////////////////////////////////////////

// HTTPS
//////////////////////////////////////////////////////////////////////////////////////
var httpsServer = null;
if (protocolsConfig["https"]) {
	var httpsConfig = protocolsConfig["https"];
	if (!httpsConfig.port) {
		console.error('no https port specified');
		process.exit(1);
	}
	if (!httpsConfig.private_key) {
		console.error('no private key file specified');
		process.exit(1);
	}
	if (!httpsConfig.certificate) {
		console.error('no certificate file specified');
		process.exit(1);
	}	
	var options = {
		key: fs.readFileSync(httpsConfig.private_key, 'utf8'),
		cert: fs.readFileSync(httpsConfig.certificate, 'utf8')	
	};
	if (httpsConfig.ca_files && httpsConfig.ca_files.length > 0) {
		var ca = [];
		for (var i in httpsConfig.ca_files)
			ca.push(fs.readFileSync(httpsConfig.ca_files[i], 'utf8'));
		options.ca = ca;
	}
	var httpsServer = https.createServer(options, app);
	httpsServer.listen(httpsConfig.port, function() {
		var host = httpsServer.address().address;
		var port = httpsServer.address().port;
		console.log('console listening at %s://%s:%s', 'https', host, port);
	})
}
//////////////////////////////////////////////////////////////////////////////////////

if (!httpServer && !httpsServer) {
	console.error('no web service to run');
	process.exit(1);
}

if (runAtStart)
	runChildProcess(serviceConfig["cmd"]);
else
	getStatusObject(function(statusObj) {sendNotification(statusObj, onSendNotificationDone);});
