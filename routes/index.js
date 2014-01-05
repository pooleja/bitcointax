
/*
 * GET home page.
 */

var https = require('https');
var http = require('http');
var blockchain = require("blockchain.wrapper");
var bitcoinAddress = require("bitcoin-address");
var moment = require('moment');
var async = require('async');
var accounting = require('accounting');

var redis = require('redis');
var client = redis.createClient(6379, '127.0.0.1');

var conversion = 100000000;


exports.index = function(req, res){
	/*blockchain.getAddressInfo("167iUyrWZEtcofuY3byNgqjyJUm3z6qXkc", function(addressInfo, err){
		if(err)
			res.send(err);
		else
			res.render('index', { title: 'BitcoinTax', info: addressInfo });
	});*/

	res.locals.formatMoney = function(data){
	  return accounting.formatMoney(data);
	}

	var params = { title: 'BitcoinTax'};

	// First get the current price
	getCurrentPrice(req, res, function(req, res, err){

		getAddressesFromSession(req);

		// Next get the transaction info for the addresses
		getAddressesInfo(req, res, function(req, res){

			// Calculate Gains
			calculateGains(req);


			// Ensure the error messages are in the session
			params["errors"] =  req.flash('error');
			params['addresses'] = req.session.addresses;	
			params['price'] = req.session.price;		
			params['totalShortTermGains'] = req.session.totalShortTermGains;
    		params['totalLongTermGains'] = req.session.totalLongTermGains;
    		params['totalGains'] = req.session.totalGains;

    		params['totalRecieved'] = req.session.totalRecieved;
    		params['totalRecievedUsd'] = req.session.totalRecievedUsd;
    		params['totalSent'] = req.session.totalSent;
    		params['totalSentUsd'] = req.session.totalSentUsd;

    		params['balance'] = req.session.balance / conversion;
    		params['balanceUsd'] = (req.session.balance / conversion) * req.session.price;

    		params['displayTransactions'] = req.session.displayTransactions;

			// Render the page with the data stored in params
			res.render('index', params);			
		});		
	});	
  
};

function calculateGains(req){
	var trxs = req.session.transactions;

	var trxSources = [];
	var displayTransactions = [];

	var totalShortTermGains = 0;
	var totalLongTermGains = 0;
	var totalGains = 0;

	var totalSent = 0;
	var totalSentUsd = 0;
	var totalRecieved = 0;
	var totalRecievedUsd = 0;

	var processedTransactions = [];


    // Iterate over the outgoing transactions and calculate the gains
    for (var i=0; i < trxs.length; i++){

    	// verify that we have not already processes this transaction hash
    	var found = false;
    	for(var j=0; j < processedTransactions.length; j++){
    		if(processedTransactions[j] == trxs[i].hash){
    			found = true;
    			break;
    		}
    	}

    	// If we already processed the transaction then skip to the next
    	if(found){
    		console.log("Transaction was already processed: " + trxs[i].hash);
    		continue;
    	}
    	
    	processedTransactions.push(trxs[i].hash);

    	// Iterate over the inputs/outputs and only calculate user addresses
    	var inputsBalance = 0;
    	var outputsBalance = 0;

    	// Inputs
    	for(var j=0; j < trxs[i].inputs.length; j++){
    		var input = trxs[i].inputs[j];
    		if(isUserAddress(input.addr, req)){
    			inputsBalance += input.value;
    		}
    	}

    	// Outputs
    	for(var j=0; j < trxs[i].outputs.length; j++){
    		var output = trxs[i].outputs[j];
    		if(isUserAddress(output.addr, req)){
    			outputsBalance += output.value;
    		}
    	}

    	console.log("Transaction "+ trxs[i].hash + " has inputs of " + inputsBalance + " and outputs of " + outputsBalance);

    	var tempTrx = trxs[i];

    	// If the user outputs are greater than the user intputs then it is an incoming transaction
    	if (outputsBalance > inputsBalance){
    		var finalBalance =  (outputsBalance - inputsBalance) / conversion;

        	totalRecieved += finalBalance;
        	totalRecievedUsd += finalBalance * tempTrx.btc_price;

    		var tempTrxSrc = {};
	        tempTrxSrc['date'] = tempTrx.date;
	        tempTrxSrc['available_amt'] = finalBalance;
	        tempTrxSrc['btc_price'] = tempTrx.btc_price;
	        trxSources.push(tempTrxSrc);

	        var displayTrx = {};
	        displayTrx['date'] = tempTrx.date;
	        displayTrx['date_str'] = tempTrx.date_str;
	        displayTrx['btc_price'] = tempTrx.btc_price;
	        displayTrx['btc_price_str'] = tempTrx.btc_price_str;
	        displayTrx['incoming'] = true;
	        displayTrx['btc_amount'] = finalBalance;
	        displayTransactions.push(displayTrx);

    	} else if(inputsBalance > outputsBalance){

    		var finalBalance = (inputsBalance - outputsBalance) / conversion;

    		totalSent += finalBalance;
        	totalSentUsd += finalBalance * tempTrx.btc_price;

        	console.log('Looking for transactions to make up ' + finalBalance);

        	var currentValCount = 0;    
        	var shortTermUsd = 0;
        	var longTermUsd = 0;
        	var totalUsd = 0;

        	tempTrx['spent'] = [];

	        for (var j=0; j < trxSources.length; j++){
	        	var tmpSource = trxSources[j];

	        	if((currentValCount < finalBalance) && (tmpSource.available_amt > 0)){
	        		
	        		var spentTrx = {};	        		        	

	        		if((currentValCount + tmpSource.available_amt) < finalBalance){	

	        			console.log("Using all of transaction " + tmpSource.available_amt);

	        			spentTrx['amount'] = tmpSource.available_amt;

	        			currentValCount += tmpSource.available_amt;
	        			tmpSource.available_amt = 0;
	        		}else{	        			

	        			console.log("Using some of the transaction " + tmpSource.available_amt);

	        			spentTrx['amount'] = (finalBalance - currentValCount);

	        			tmpSource.available_amt = tmpSource.available_amt - (finalBalance - currentValCount);
	        			currentValCount = finalBalance;	        			
	        		}

	        		spentTrx['date'] = tmpSource.date;
	        		spentTrx['usd_amount'] = spentTrx.amount * tmpSource.btc_price; 

	        		tempTrx['spent'].push(spentTrx);

	        		// calculate gains
	        		var currentGains = (spentTrx.amount * tempTrx.btc_price) - spentTrx.usd_amount;

	        		var sourceDate = moment(spentTrx.date);
					var trasactionDate = moment(tempTrx.date);	

					// Only calculate short/long term gains for transactions that happened in 2013
					if(trasactionDate.year() == 2013){				
						if(trasactionDate.diff(sourceDate, 'days') < 365){
							shortTermUsd += currentGains;
						}					
						else{
							longTermUsd += currentGains;
						}
					}

					totalUsd += currentGains;
	        	}
	        }	       	 

	  		var displayTrx = {};
	        displayTrx['date'] = tempTrx.date;
	        displayTrx['date_str'] = tempTrx.date_str;
	        displayTrx['btc_price'] = tempTrx.btc_price;
	        displayTrx['btc_price_str'] = tempTrx.btc_price_str;
	        displayTrx['incoming'] = false;
	        displayTrx['btc_amount'] = finalBalance;
	        displayTrx['shortTermGains'] = shortTermUsd;
	  		displayTrx['longTermUsd'] = longTermUsd;
	  		displayTrx['totalGains'] = totalUsd;
	  		displayTrx['spent'] = tempTrx.spent;
	        displayTransactions.push(displayTrx);

	  		totalShortTermGains += shortTermUsd;
	  		totalLongTermGains += longTermUsd;
	  		totalGains += totalUsd;	
    	}
    }

    req.session.totalShortTermGains = totalShortTermGains;
    req.session.totalLongTermGains = totalLongTermGains;
    req.session.totalGains = totalGains;

    req.session.totalRecieved = totalRecieved;
    req.session.totalRecievedUsd = totalRecievedUsd;
    req.session.totalSent = totalSent;
    req.session.totalSentUsd = totalSentUsd;

    req.session.displayTransactions = displayTransactions;   
}

function isUserAddress(address, req){
	for (var i=0; i < req.session.addresses.length; i++){			
        if(address == req.session.addresses[i])
        	return true;
    }

    return false;
}

function getAddressesFromSession(req){
	
	var addresses = [];	

	if(req.session.addresses) {
		for (var i=0; i < req.session.addresses.length; i++){			
            addresses.push(req.session.addresses[i]);
        }
	}

	// Submitted from form when adding address
	if(req.body.newAddress){
		if(bitcoinAddress.validate(req.body.newAddress))
			addresses.push(req.body.newAddress);
		else
			req.flash('error', 'Invalid address entered: ' + req.body.newAddress);
	}
		
	// Submitted from form when removing address	
	if(req.body.removeAddress){
		// Find and remove item from an array
		var i = addresses.indexOf(req.body.removeAddress);
		if(i != -1) {
			addresses.splice(i, 1);
		}
	}
	
	req.session.addresses = addresses;

}

function getCurrentPrice(req, res, callback){

	if(req.session.price){
		callback(req, res);
	}
	else{
		https.get('https://coinbase.com/api/v1/prices/spot_rate', function(coinRes) {
		    var body = '';

		    coinRes.on('data', function(chunk) {
		        body += chunk;
		    });

		    coinRes.on('end', function() {
		        var goxResponse = JSON.parse(body)		        
		        req.session.price = goxResponse.amount;
	    		callback(req, res, null);
		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
		      req.flash('error', "Error getting current price from Coinbase.com");
		      req.session.price = 0;
		      callback(req, res, e);
		});
	}	

}

function getAddressesInfo(req, res, callback){	

	var addressList = "";

	// Verify there are addresses to process and get out if not
	if(req.session.addresses.length == 0){
		req.session.transactions = [];	
		callback(req, res);
	}
	else{

		req.session.transactions = [];
		req.session.balance = 0;
		var addressesToLookup = [];
		
		// Iterate over the addresses and see if we hit any from the cache		
		for (var i=0; i < req.session.addresses.length; i++){			
	        var addr = req.session.addresses[i];

	        console.log("Looking for " + addr + " in the cache.");

	        var obj = req.session[addr];
	        if(obj){
	        	var cacheDate = moment(obj.cacheDate);
				var nowDate = moment();	
			
				// If the object was cached in the last 5 mins, use it
				if(nowDate.diff(cacheDate, 'minutes') < 10){

					console.log(addr + " was found in the cache from the last 5 minutes.");

					var addressTrx = obj.trxs;
			        for (var j=0; j < addressTrx.length; j++){
			        	req.session.transactions.push(addressTrx[j]);
			        }
			        req.session.balance += obj.totalVal;

			        // Continue in the loop so the lookup value doesn't get pushed
					continue;
				}			
	        }

	        console.log(addr + " was not found in the cache.");
			addressesToLookup.push(addr);	        
	    }

	    if(addressesToLookup.length > 0){
			// Asynchronously call the API to get blockchain info
			async.map(addressesToLookup, getBlockChainInfo, function(err, results){
		    	if(err){
		    		console.log("Got error: ", err);
		    		req.flash('error', "Error address info from Coinbase.");
		    	}
		    	else{
		    		for (var i=0; i < results.length; i++){			
				        var addressTrx = results[i].trxs;
				        for (var j=0; j < addressTrx.length; j++){
				        	req.session.transactions.push(addressTrx[j]);
				        }
				        req.session.balance += results[i].totalVal;

				        // Save it to the session cache
				        results[i]['cacheDate'] = new Date();
				        req.session[results[i].address] = results[i];
				    }

				    req.session.transactions.sort(compareTrx);
		    		callback(req, res);
		    	}
		    		
			});      
		}  
		else{

			console.log("All addresses were found in the cache.");

			req.session.transactions.sort(compareTrx);
		    callback(req, res);
		}
					
	}
}

function compareTrx(a,b) {
	var firstDate = moment(a.date);
	var secondDate = moment(b.date);
  if (secondDate.isBefore(firstDate))
     return 1;
  if (firstDate.isBefore(secondDate))
    return -1;
  return 0;
}

function getBlockChainInfo(address, callback){		

	console.log("Getting " + address + " from the blockchain info API.");

	https.get('https://blockchain.info/address/' + address + '?format=json' , function(data) {
			var body = '';

		    data.on('data', function(chunk) {
		        body += chunk;
		    });

		    data.on('end', function() {
		        var addressResponse = JSON.parse(body);

		        getTransactions(addressResponse, function(transactions){
		        	var ret	= {};
		        	ret['trxs'] = transactions;
		        	ret['totalVal'] = addressResponse.final_balance;
		        	ret['address'] = address;			        	

		        	callback(null, ret);
		        });

		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
		      req.flash('error', "Error address info from Blockchain.info.");
		      callback(e);
	});
}

function getTransactions(info, callback){

	for (var i=0; i < info.txs.length; i++){			
        info.txs[i]['sourceAddress'] = info.address;
    }

	async.map(info.txs, convertTransaction, function(err, results){
    	
    	if(err){
    		console.log("Got error: ", err);
    		req.flash('error', "Error converting transaction.");
    	}
    	else{    		
    		callback(results);
    	}
    		
	});        
}

function convertTransaction(tx, callback){

	var d = new Date(tx.time * 1000);
	getPriceForDate(d, function(price){

		var tempTransaction = {};
		tempTransaction['date'] = d;
		tempTransaction['date_str'] = moment(tx.time * 1000).format("YYYY-MM-DD");
		tempTransaction['btc_price'] = price;
		tempTransaction['btc_price_str'] = accounting.formatMoney(price);
		tempTransaction['hash'] = tx.hash;

		var outputs = [];
		var inputs = [];

		// Iterate over inputs
		for (var i=0; i < tx.inputs.length; i++){			
	        var input = tx.inputs[i].prev_out;

	        inputs.push(input);
	    }	    

	    // Iterate over outputs
		for (var i=0; i < tx.out.length; i++){
	        var output = tx.out[i];
	        outputs.push(output);
	    }	    
	
		tempTransaction['outputs'] = outputs;
		tempTransaction['inputs'] = inputs;
		
		callback(null, tempTransaction);

	});	
}

function getPriceForDate(d, callback){

	var hashId = "daily";
	var dayId = moment(d).format("YYYY-MM-DD");


	client.hget(hashId, dayId, function(err, value){
		if(err){
			console.log(err);
			req.flash('error', "Error retrieving data.");
		}

		if(!value){
			console.log('not found in Redis: ' + dayId);
			getDailyPrices(dayId, callback);
		}
		else
			callback(value);
	});
	
}

function getDailyPrices(dayId, callback){

	http.get('http://www.quandl.com/api/v1/datasets/BCHAIN/MKPRU.json', function(data) {
		var body = '';

	    data.on('data', function(chunk) {
	        body += chunk;
	    });

	    data.on('end', function() {
	        var pricesResponse = JSON.parse(body);

	        for (var i=0; i < pricesResponse.data.length; i++){			        	
	        	var dString = "" + pricesResponse.data[i][0];
	        	var obj = {};
	        	obj[dString] = pricesResponse.data[i][1];
			    client.hmset('daily', obj);
			}
	         		        
    		getPriceForDate(dayId, callback);
	    });
	}).on('error', function(e) {
		req.flash('error', "Error getting prices from Quandl.com.");
	      console.log("Got error: ", e);
	      callback(e);
	});

}