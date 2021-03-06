'use strict';
var _ = require('lodash');
var parse = require('./parse');

function $RootScopeProvider() {
	var TTL = 10;
	this.digestTtl = function(value) {
		if (_.isNumber(value)) {
			TTL = value;
		}
		return TTL;
	}
	this.$get = ['$parse',function($parse) {
		function Scope(){
			this.$$watchers = [];
			this.$$lastDirtyWatch = null;
			this.$$asyncQueue = [];
			this.$$applyAsyncQueue = [];
			this.$$postDigestQueue = [];
			this.$$applyAsyncId = null;
			this.$$children = [];
			this.$$phase = null;
			this.$root = this;
			this.$$listeners = {};
		}
		function initWatchVal(){

		}
		Scope.prototype.$watch = function(watchFn,listenerFn,valueEq){
			var self = this;
			watchFn = $parse(watchFn);
			// 表达式的watch代理
			if (watchFn.$$watchDelegate) {
				return watchFn.$$watchDelegate(self, listenerFn, valueEq, watchFn);
			}
			var watcher = {
				watchFn: watchFn,
				listenerFn: listenerFn || function() { },
				valueEq: !!valueEq,
				last: initWatchVal
			};
			this.$$watchers.unshift(watcher);
			this.$root.$$lastDirtyWatch = null;
			return function(){
				var index = self.$$watchers.indexOf(watcher);
				if(index >= 0){
					self.$$watchers.splice(index,1);
					self.$root.$$lastDirtyWatch = null;
				}
			};
		};
		Scope.prototype.$$digestOnce = function(){
			var dirty;
			var continueLoop = true;
			var self = this;
			this.$$everyScope(function(scope){
				var newValue, oldValue;
				_.forEachRight(scope.$$watchers, function(watcher){
					try{
						if(watcher){
							newValue = watcher.watchFn(scope);
							oldValue = watcher.last;
							if(!scope.$$areEqual(newValue,oldValue,watcher.valueEq)){
								self.$root.$$lastDirtyWatch = watcher;
								watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
								watcher.listenerFn(newValue, (oldValue === initWatchVal ? newValue : oldValue ), scope);
								dirty = true;
							} else if (self.$root.$$lastDirtyWatch === watcher){
								continueLoop = false;
								return false;
							}
						}
					} catch(e){
						console.error(e);
						}
					});
				  return continueLoop;	
			});
			return dirty;
		};
		Scope.prototype.$digest = function(){
			var ttl = TTL;
			var dirty;
			this.$root.$$lastDirtyWatch = null;
			this.$beginPhase('digest');
			if (this.$root.$$applyAsyncId){
				clearTimeout(this.$root.$$applyAsyncId);
				this.$$flushApplyAsync();
			}
			do {
				while (this.$$asyncQueue.length){
					try {	
						var asyncTask = this.$$asyncQueue.shift();
						asyncTask.scope.$eval(asyncTask.expression);
					} catch(e){
						console.error(e);
					}
				}
				dirty = this.$$digestOnce();
				if((dirty || this.$$asyncQueue.length) && !(ttl--)){
					this.$clearPhase();
					throw TTL + ' digest iterations reached';
				}
			}while(dirty || this.$$asyncQueue.length);
			this.$clearPhase();
			while (this.$$postDigestQueue.length){
				try{
					this.$$postDigestQueue.shift()();
				}catch(e){
					console.error(e);
				}
			}
		};
		Scope.prototype.$$areEqual = function(newValue,oldValue,valueEq){
			if(valueEq){
				return _.isEqual(newValue,oldValue);
			}else{
				return newValue === oldValue || (typeof newValue === 'number' && typeof oldValue === 'number' && isNaN(newValue) && isNaN(oldValue));
			}
		};
		Scope.prototype.$eval = function(expr,locals){
			return $parse(expr)(this,locals);
		};
		Scope.prototype.$apply = function(expr){
			try {
				this.$beginPhase('apply');
				return this.$eval(expr);
			} finally {
				this.$clearPhase();
				this.$root.$digest();
			}
		};
		Scope.prototype.$evalAsync = function(expr){
			var self = this;
			if(!self.$$phase && !self.$$asyncQueue.length){
				setTimeout(function(){
					if(self.asyncQueue.length){
						self.$root.$digest();
					}
				},0);
			}
			self.$$asyncQueue.push({scope: self, expression: expr});
		};
		Scope.prototype.$beginPhase = function(phase){
			if(this.$$phase){
				throw this.$$phase + 'already in progress';
			}
			this.$$phase = phase;
		};
		Scope.prototype.$clearPhase = function(){
			this.$$phase = null;
		};
		Scope.prototype.$$flushApplyAsync = function(){
			while (this.$$applyAsyncQueue.length){
				try {
					this.$$applyAsyncQueue.shift()();
				} catch(e){
					console.error(e);
				}
			}
			this.$root.$$applyAsyncId = null;
		};
		Scope.prototype.$applyAsync = function(expr){
			var self = this;
			self.$$applyAsyncQueue.push(function(){
				self.$eval(expr);
			});
			if(self.$root.$$applyAsyncId === null){
				self.$root.$$applyAsyncId = setTimeout(function(){
					self.$apply(function(){
						self.$apply(_.bind(self.$$flushApplyAsync,self));
					});
				});
			}
		};
		Scope.prototype.$$postDigest = function(fn){
			this.$$postDigestQueue.push(fn);
		};
		Scope.prototype.$watchGroup = function(watchFns,listenerFn){
			var self = this;
			var newValues = new Array(watchFns.length);
			var oldValues = new Array(watchFns.length); 
			var changeReactionScheduled = false;
			var firstRun = true;
			if (watchFns.length === 0){
				var shouldCall = true;
				self.$evalAsync(function(){
					if(shouldCall){
						listenerFn(newValues,newValues,self);
					}
				});
				return function(){
					shouldCall = false;
				};
			}
			function watchGroupListener(){
				if (firstRun){
					firstRun = false;
					listenerFn(newValues,newValues,self);
				}
				listenerFn(newValues,oldValues,self);
				changeReactionScheduled = false;
			}                    
			var destroyFunctions = _.map(watchFns,function(watchFn,i){
				self.$watch(watchFn,function(newValue,oldValue){
					newValues[i] = newValue;
					oldValues[i] = oldValue;
					if(!changeReactionScheduled){
						changeReactionScheduled = true;
						self.$evalAsync(watchGroupListener);}
					});
			});
			return function(){
				_.forEach(destroyFunctions,function(destroyFunction){
					destroyFunction();
				});
			};
		};
		Scope.prototype.$new = function(isolated,parent){
			var child;
			parent = parent || this;
			if(isolated){
				child = new Scope();
				child.$root = parent.$root;
				child.$$asyncQueue = parent.$$asyncQueue;
				child.$$postDigestQueue = parent.$$postDigestQueue;
				child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
			} else {
				var ChildScope = function(){};
				ChildScope.prototype = this;
				child = new ChildScope();
			}
			parent.$$children.push(child);
			child.$$watchers = [];
			child.$$listeners = {};
			child.$$children = [];
			child.$parent = parent;
			return child;
		};
		Scope.prototype.$$everyScope = function(callback){
			if(callback(this)){
				return this.$$children.every(function(child){
					return child.$$everyScope(callback);
				});
			}else{
				return false;
			}
		};
		Scope.prototype.$destroy = function(){
			this.$broadcast('$destroy')
			if(this.$parent){
				var index = this.$parent.$$children.indexOf(this);
				if(index >= 0){
					this.$parent.$$children.splice(index,1);
				}
			}
			this.$$watchers = null;
			this.$$listeners = {};
		};
		Scope.prototype.$watchCollection = function(watchFn, listenerFn){
			var self = this;
			var newValue;
			var oldValue;
			var changeCount = 0;

			function isArrayLike(obj){
				if(_.isUndefined(obj) || _.isNull(obj) || obj === window || typeof obj == 'function'){
					return false;
				}
				return _.isNumber(obj.length);
			};

			var internalWatchFn = function(scope){
				newValue = $parse(watchFn)(scope);
				
				if(_.isObject(newValue)){
					if(isArrayLike(newValue)){
						if(!_.isArray(oldValue)){
							changeCount++;
							oldValue = [];
						} 
						if(newValue.length !== oldValue.length){
							changeCount++;
							oldValue.length = newValue.length;
						}
						_.forEach(newValue,function(item,i){
							var bothNaN = _.isNaN(item) && _.isNaN(oldValue[i])
							if(!bothNaN && item != oldValue[i]){
								changeCount++;
								oldValue[i] = item;
							}
						});

					}else{

					}
				}else {
					if (!self.$$areEqual(newValue, oldValue,false)){
						changeCount++;
					}
					oldValue = newValue;
				}
				return changeCount;
			};
			var internalListenFn = function(scope){
				listenerFn(newValue,oldValue,self);
			};
			return this.$watch(internalWatchFn,internalListenFn);
		};

		Scope.prototype.$on = function(eventName,listener){
			var self = this;
			if(eventName && typeof eventName == "string" && typeof listener == "function"){
				var listeners = this.$$listeners[eventName];
				if(!listeners){
					this.$$listeners[eventName] = listeners = [];
				}
				listeners.push(listener); //操作的引用而不是值。所以此处push listeners会使得this.$$listeners[name]值改变。
				
				return function(){
					var index = listeners.indexOf(listener)
					if(index >= 0 ){
						listeners.splice(index,1)
					}
				}	
			}
		};

		Scope.prototype.$emit = function(eventName){
			var propagationStopped = false;
			var event = {
				name:eventName,
				targetScope: this,
				stopPropagation : function(){
					propagationStopped = true;

				},
				preventDefault: function(){
					event.defaultPrevented = true;
				}
			};
			var listenerArgs = [event].concat(_.tail(arguments));
			var scope = this;
			var loopFlag = true;
			do{
				scope.$$fireEventOnScope(eventName,listenerArgs);
				scope = scope.$parent;
				event.currentScope = scope;
			} while (scope && !event.propagationStopped )
			event.currentScope = null;

			return event;
		}

		Scope.prototype.$broadcast = function(eventName){
			var event = {
				name:eventName,
				targetScope: this,
				preventDefault: function(){
					event.defaultPrevented = true;
				}
			};
			var listenerArgs = [event].concat(_.tail(arguments));
			this.$$everyScope(function(scope){
				event.currentScope = scope;
				scope.$$fireEventOnScope(eventName,listenerArgs);
				return true;
			})
			event.currentScope = null;
			return event;
		}

		Scope.prototype.$$fireEventOnScope = function(eventName,listenerArgs){
			var listeners = this.$$listeners[eventName] || [];
			var event = {name:eventName};
			_.forEach(listeners,function(listener){
				try{
					listener.apply(null,listenerArgs); //将context(null)指定为listener函数的上下文 如何考虑？？
				} catch(err){
					console.log(err);
				}
			})
			
			return event;
		}

		var $rootScope = new Scope();
		return $rootScope;

	}];
}


module.exports = $RootScopeProvider;