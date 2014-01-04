
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
	getCurrentPrice(req, res, function(req, res){

		getAddressesFromSession(req);

		// Next get the transaction info for the addresses
		getAddressesInfo(req, res, function(req, res){

			// Calculate Gains
			calculateGains(req);


			// Ensure the error messages are in the session
			params["errors"] =  req.flash('error');
			params['addresses'] = req.session.addresses;
			params['transactions'] = req.session.transactions;
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

			// Render the page with the data stored in params
			res.render('index', params);			
		});		
	});	
  
};

function calculateGains(req){
	var trxs = req.session.transactions;

	var trxSources = [];

	var totalShortTermGains = 0;
	var totalLongTermGains = 0;
	var totalGains = 0;

	var totalSent = 0;
	var totalSentUsd = 0;
	var totalRecieved = 0;
	var totalRecievedUsd = 0;


    // Iterate over the outgoing transactions and calculate the gains
    for (var i=0; i < trxs.length; i++){
        var tempTrx = trxs[i];                    
        var btcAmount = 0;

        if(tempTrx.incoming){
        	btcAmount = tempTrx.btc_amount;
        	totalRecieved += btcAmount;
        	totalRecievedUsd += btcAmount * tempTrx.btc_price;

	        var tempTrxSrc = {};
	        tempTrxSrc['date'] = tempTrx.date;
	        tempTrxSrc['available_amt'] = tempTrx.btc_amount;
	        tempTrxSrc['btc_price'] = tempTrx.btc_price;
	        trxSources.push(tempTrxSrc);

	        console.log("Adding trx source: " + tempTrxSrc.date + " - " + tempTrxSrc.available_amt);
    	} 
        else{

        	btcAmount = tempTrx.btc_amount * -1;
        	totalSent += btcAmount;
        	totalSentUsd += btcAmount * tempTrx.btc_price;

        	console.log('Looking for transactions to make up ' + btcAmount);

        	var currentValCount = 0;    
        	var shortTermUsd = 0;
        	var longTermUsd = 0;
        	var totalUsd = 0;

        	tempTrx['spent'] = [];

	        for (var j=0; j < trxSources.length; j++){
	        	var tmpSource = trxSources[j];

	        	if((currentValCount < btcAmount) && (tmpSource.available_amt > 0)){
	        		var spentTrx = {};	        		        	

	        		if((currentValCount + tmpSource.available_amt) < btcAmount){	

	        			console.log("Using all of transaction " + tmpSource.available_amt);

	        			spentTrx['amount'] = tmpSource.available_amt;

	        			currentValCount += tmpSource.available_amt;
	        			tmpSource.available_amt = 0;
	        		}else{	        			

	        			console.log("Using some of the transaction " + tmpSource.available_amt);

	        			spentTrx['amount'] = (btcAmount - currentValCount);

	        			tmpSource.available_amt = tmpSource.available_amt - (btcAmount - currentValCount);
	        			currentValCount = btcAmount;	        			
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

	  		tempTrx['shortTermGains'] = shortTermUsd;
	  		tempTrx['longTermUsd'] = longTermUsd;
	  		tempTrx['totalGains'] = totalUsd;

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

}

function getAddressesFromSession(req){
	
	var addresses = [];	

	if(req.session.addresses) {
		for (var i=0; i < req.session.addresses.length; i++){			
            addresses.push(req.session.addresses[i]);
        }
	}

	if(req.body.newAddress){
		if(bitcoinAddress.validate(req.body.newAddress))
			addresses.push(req.body.newAddress);
		else
			req.flash('error', 'Invalid address entered: ' + req.body.newAddress);
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
	    		callback(req, res);
		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
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

		// Asynchronously call the API to get blockchain info
		async.map(req.session.addresses, getBlockChainInfo, function(err, results){
	    	if(err)
	    		console.log("Got error: ", err);
	    	else{
	    		for (var i=0; i < results.length; i++){			
			        var addressTrx = results[i].trxs;
			        for (var j=0; j < addressTrx.length; j++){
			        	req.session.transactions.push(addressTrx[j]);
			        }
			        req.session.balance += results[i].totalVal;
			    }

			    req.session.transactions.sort(compareTrx)
	    		callback(req, res);
	    	}
	    		
		});        
					
	}
}

function compareTrx(a,b) {
  if (a.date < b.date)
     return -1;
  if (a.date > b.date)
    return 1;
  return 0;
}

function getBlockChainInfo(address, callback){		

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
		        	callback(null, ret);
		        });

		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
		      callback(e);
	});
}

function getTransactions(info, callback){

	for (var i=0; i < info.txs.length; i++){			
        info.txs[i]['sourceAddress'] = info.address;
    }

	async.map(info.txs, convertTransaction, function(err, results){
    	
    	if(err)
    		console.log("Got error: ", err);
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

		var balance = 0;
		// Iterate over inputs
		for (var i=0; i < tx.inputs.length; i++){			
	        var input = tx.inputs[i].prev_out;
	        if(input.addr == tx.sourceAddress){	        		        		        
	        	balance -= input.value;
	        }
	    }

	    // Iterate over outputs
		for (var i=0; i < tx.out.length; i++){			
	        var output = tx.out[i];
	        if(output.addr == tx.sourceAddress){	        	
	        	balance += output.value;
	        }
	    }
		
		if(balance >= 0){			
			tempTransaction['incoming'] = true;		
		}else{			
			tempTransaction['incoming'] = false;
		}

		tempTransaction['btc_amount'] = balance / conversion;
		

		callback(null, tempTransaction);

	});	
}

function getPriceForDate(d, callback){

	var hashId = "daily";
	var dayId = moment(d).format("YYYY-MM-DD");


	client.hget(hashId, dayId, function(err, value){
		if(err)
			console.log(err);

		if(!value){
			console.log('not found in Redis: ' + dayId);
			getDailyPrices(dayId, callback);
		}
		else
			callback(value);
	});
	
}

function getDailyPrices(dayId, callback){

	http.get('http://www.quandl.com/api/v1/datasets/BCHAIN/MKPRU.json?auth_token=F343hstxmzpV5zjQqyLU', function(data) {
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
			    client.HMSET('daily', obj);
			}
	         		        
    		getPriceForDate(dayId, callback);
	    });
	}).on('error', function(e) {
	      console.log("Got error: ", e);
	      callback(e);
	});

}