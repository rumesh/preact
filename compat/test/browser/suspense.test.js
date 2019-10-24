/* eslint-env browser, mocha */
/** @jsx h */
import { setupRerender } from 'preact/test-utils';
import { createElement as h, render, Component, Suspense, lazy, Fragment } from '../../src/index';
import { setupScratch, teardown } from '../../../test/_util/helpers';

function createLazy() {

	/** @type {(c: ComponentType) => Promise<void>} */
	let resolver, rejecter, promise;
	const Lazy = lazy(() => promise = new Promise((resolve, reject) => {
		resolver = c => {
			resolve({ default: c });
			return promise;
		};

		rejecter = () => {
			reject();
			return promise;
		};
	}));

	return [Lazy, c => resolver(c), e => rejecter(e)];
}

/**
 * @typedef {import('../../../src').ComponentType} ComponentType
 * @typedef {[(c: ComponentType) => Promise<void>, (error: Error) => Promise<void>]} Resolvers
 * @param {ComponentType} DefaultComponent
 * @returns {[typeof Component, () => Resolvers]}
 */
function createSuspender(DefaultComponent) {

	/** @type {(lazy: h.JSX.Element) => void} */
	let renderLazy;
	class Suspender extends Component {
		constructor(props, context) {
			super(props, context);
			this.state = { Lazy: null };

			renderLazy = Lazy => this.setState({ Lazy });
		}

		render(props, state) {
			return state.Lazy ? h(state.Lazy, {}) : h(DefaultComponent, {});
		}
	}

	sinon.spy(Suspender.prototype, 'render');

	/**
	 * @returns {Resolvers}
	 */
	function suspend() {
		const [Lazy, resolve, reject] = createLazy();
		renderLazy(Lazy);
		return [resolve, reject];
	}

	return [Suspender, suspend];
}

class Catcher extends Component {
	constructor(props) {
		super(props);
		this.state = { error: false };
	}

	componentDidCatch(e) {
		if (e.then) {
			this.setState({ error: { message: '{Promise}' } });
		}
		else {
			this.setState({ error: e });
		}
	}

	render(props, state) {
		return state.error ? <div>Catcher did catch: {state.error.message}</div> : props.children;
	}
}

describe('suspense', () => {
	let scratch, rerender, unhandledEvents = [];

	function onUnhandledRejection(event) {
		unhandledEvents.push(event);
	}

	beforeEach(() => {
		scratch = setupScratch();
		rerender = setupRerender();

		unhandledEvents = [];
		if ('onunhandledrejection' in window) {
			window.addEventListener('unhandledrejection', onUnhandledRejection);
		}
	});

	afterEach(() => {
		teardown(scratch);

		if ('onunhandledrejection' in window) {
			window.removeEventListener('unhandledrejection', onUnhandledRejection);

			if (unhandledEvents.length) {
				throw unhandledEvents[0].reason;
			}
		}
	});

	it('should support lazy', () => {
		const LazyComp = ({ name }) => <div>Hello from {name}</div>;

		/** @type {() => Promise<void>} */
		let resolve;
		const Lazy = lazy(() => {
			const p = new Promise((res) => {
				resolve = () => {
					res({ default: LazyComp });
					return p;
				};
			});

			return p;
		});

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Lazy name="LazyComp" />
			</Suspense>
		), scratch); // Render initial state
		rerender(); // Re-render with fallback cuz lazy threw

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve().then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Hello from LazyComp</div>`
			);
		});
	});

	it('lazy should forward refs', () => {
		const LazyComp = () => <div>Hello from LazyComp</div>;
		let ref = {};

		/** @type {() => Promise<void>} */
		let resolve;
		const Lazy = lazy(() => {
			const p = new Promise((res) => {
				resolve = () => {
					res({ default: LazyComp });
					return p;
				};
			});

			return p;
		});

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Lazy ref={ref} />
			</Suspense>
		), scratch);
		rerender();

		return resolve().then(() => {
			rerender();
			expect(ref.current._vnode.type).to.equal(LazyComp);
		});
	});

	it('should suspend when a promise is thrown', () => {
		class ClassWrapper extends Component {
			render(props) {
				return (
					<div id="class-wrapper">
						{props.children}
					</div>
				);
			}
		}

		const FuncWrapper = props => (
			<div id="func-wrapper">
				{props.children}
			</div>
		);

		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<ClassWrapper>
					<FuncWrapper>
						<Suspender />
					</FuncWrapper>
				</ClassWrapper>
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div id="class-wrapper"><div id="func-wrapper"><div>Hello</div></div></div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve(() => <div>Hello2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div id="class-wrapper"><div id="func-wrapper"><div>Hello2</div></div></div>`
			);
		});
	});

	it('should not call lifecycle methods when suspending', () => {
		let componentWillMount = sinon.spy();
		let componentDidMount = sinon.spy();
		let componentWillUnmount = sinon.spy();
		class LifecycleLogger extends Component {
			render() {
				return <div>Lifecycle</div>;
			}
			componentWillMount() { componentWillMount(); }
			componentDidMount() { componentDidMount(); }
			componentWillUnmount() { componentWillUnmount(); }
		}

		const [Suspender, suspend] = createSuspender(() => <div>Suspense</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Suspender />
				<LifecycleLogger />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Lifecycle</div>`
		);
		expect(componentWillMount).to.have.been.calledOnce;
		expect(componentDidMount).to.have.been.calledOnce;
		expect(componentWillUnmount).to.not.have.been.called;

		const [resolve] = suspend();

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);
		expect(componentWillMount).to.have.been.calledOnce;
		expect(componentDidMount).to.have.been.calledOnce;
		expect(componentWillUnmount).to.not.have.been.called;

		return resolve(() => <div>Suspense 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspense 2</div><div>Lifecycle</div>`
			);

			expect(componentWillMount).to.have.been.calledOnce;
			expect(componentDidMount).to.have.been.calledOnce;
			expect(componentWillUnmount).to.not.have.been.called;
		});
	});

	it('should call fallback\'s lifecycle methods when suspending', () => {
		class LifecycleLogger extends Component {
			render() {
				return <div>Lifecycle</div>;
			}
			componentWillMount() {}
			componentDidMount() {}
			componentWillUnmount() {}
		}

		const componentWillMount = sinon.spy(LifecycleLogger.prototype, 'componentWillMount');
		const componentDidMount = sinon.spy(LifecycleLogger.prototype, 'componentDidMount');
		const componentWillUnmount = sinon.spy(LifecycleLogger.prototype, 'componentWillUnmount');

		const [Suspender, suspend] = createSuspender(() => <div>Suspense</div>);

		render((
			<Suspense fallback={<LifecycleLogger />}>
				<Suspender />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div>`
		);
		expect(componentWillMount).to.not.have.been.called;
		expect(componentDidMount).to.not.have.been.called;
		expect(componentWillUnmount).to.not.have.been.called;

		const [resolve] = suspend();

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Lifecycle</div>`
		);
		expect(componentWillMount).to.have.been.calledOnce;
		expect(componentDidMount).to.have.been.calledOnce;
		expect(componentWillUnmount).to.not.have.been.called;

		return resolve(() => <div>Suspense 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspense 2</div>`
			);

			expect(componentWillMount).to.have.been.calledOnce;
			expect(componentDidMount).to.have.been.calledOnce;
			expect(componentWillUnmount).to.have.been.calledOnce;
		});
	});

	it('should keep state of children when suspending', () => {

		/** @type {(state: { s: string }) => void} */
		let setState;
		class Stateful extends Component {
			constructor(props) {
				super(props);
				setState = this.setState.bind(this);
				this.state = { s: 'initial' };
			}
			render(props, state) {
				return <div>Stateful: {state.s}</div>;
			}
		}

		const [Suspender, suspend] = createSuspender(() => <div>Suspense</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Suspender />
				<Stateful />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: initial</div>`
		);

		setState({ s: 'first' });
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: first</div>`
		);

		const [resolve] = suspend();

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve(() => <div>Suspense 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspense 2</div><div>Stateful: first</div>`
			);
		});
	});

	// TODO: Fix this test
	it.skip('should allow children to update state while suspending', () => {

		/** @type {(state: { s: string }) => void} */
		let setState;
		class Stateful extends Component {
			constructor(props) {
				super(props);
				setState = this.setState.bind(this);
				this.state = { s: 'initial' };
			}
			render(props, state) {
				return <div>Stateful: {state.s}</div>;
			}
		}

		const [Suspender, suspend] = createSuspender(() => <div>Suspense</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Suspender />
				<Stateful />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: initial</div>`
		);

		setState({ s: 'first' });
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: first</div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		setState({ s: 'second' });
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve(() => <div>Suspense 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspense 2</div><div>Stateful: second</div>`
			);
		});
	});

	it('should allow siblings of Suspense to update state while suspending', () => {

		/** @type {(state: { s: string }) => void} */
		let setState;
		class Stateful extends Component {
			constructor(props) {
				super(props);
				setState = this.setState.bind(this);
				this.state = { s: 'initial' };
			}
			render(props, state) {
				return <div>Stateful: {state.s}</div>;
			}
		}

		const [Suspender, suspend] = createSuspender(() => <div>Suspense</div>);

		render(
			<Fragment>
				<Suspense fallback={<div>Suspended...</div>}>
					<Suspender />
				</Suspense>
				<Stateful />
			</Fragment>,
			scratch
		);

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: initial</div>`
		);

		setState({ s: 'first' });
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspense</div><div>Stateful: first</div>`
		);

		const [resolve] = suspend();

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div><div>Stateful: first</div>`
		);

		setState({ s: 'second' });
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div><div>Stateful: second</div>`
		);

		return resolve(() => <div>Suspense 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspense 2</div><div>Stateful: second</div>`
			);
		});
	});

	it('should suspend with custom error boundary', () => {
		const [Suspender, suspend] = createSuspender(() => <div>within error boundary</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Catcher>
					<Suspender />
				</Catcher>
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>within error boundary</div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve(() => <div>within error boundary 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>within error boundary 2</div>`
			);
		});
	});

	it('should allow multiple children to suspend', () => {
		const [Suspender1, suspend1] = createSuspender(() => <div>Hello first</div>);
		const [Suspender2, suspend2] = createSuspender(() => <div>Hello second</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Catcher>
					<Suspender1 />
					<Suspender2 />
				</Catcher>
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Hello first</div><div>Hello second</div>`
		);
		expect(Suspender1.prototype.render).to.have.been.calledOnce;
		expect(Suspender2.prototype.render).to.have.been.calledOnce;

		const [resolve1] = suspend1();
		const [resolve2] = suspend2();
		expect(Suspender1.prototype.render).to.have.been.calledOnce;
		expect(Suspender2.prototype.render).to.have.been.calledOnce;

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);
		expect(Suspender1.prototype.render).to.have.been.calledTwice;
		expect(Suspender2.prototype.render).to.have.been.calledTwice;

		return resolve1(() => <div>Hello first 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspended...</div>`
			);
			expect(Suspender1.prototype.render).to.have.been.calledTwice;
			expect(Suspender2.prototype.render).to.have.been.calledTwice;

			return resolve2(() => <div>Hello second 2</div>).then(() => {
				rerender();
				expect(scratch.innerHTML).to.eql(
					`<div>Hello first 2</div><div>Hello second 2</div>`
				);
				expect(Suspender1.prototype.render).to.have.been.calledThrice;
				expect(Suspender2.prototype.render).to.have.been.calledThrice;
			});
		});
	});

	it('should call multiple nested suspending components render in one go', () => {
		const [Suspender1, suspend1] = createSuspender(() => <div>Hello first</div>);
		const [Suspender2, suspend2] = createSuspender(() => <div>Hello second</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Catcher>
					<Suspender1 />
					<div>
						<Suspender2 />
					</div>
				</Catcher>
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Hello first</div><div><div>Hello second</div></div>`
		);
		expect(Suspender1.prototype.render).to.have.been.calledOnce;
		expect(Suspender2.prototype.render).to.have.been.calledOnce;

		const [resolve1] = suspend1();
		const [resolve2] = suspend2();
		expect(Suspender1.prototype.render).to.have.been.calledOnce;
		expect(Suspender2.prototype.render).to.have.been.calledOnce;

		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);
		expect(Suspender1.prototype.render).to.have.been.calledTwice;
		expect(Suspender2.prototype.render).to.have.been.calledTwice;

		return resolve1(() => <div>Hello first 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<div>Suspended...</div>`
			);
			expect(Suspender1.prototype.render).to.have.been.calledTwice;
			expect(Suspender2.prototype.render).to.have.been.calledTwice;

			return resolve2(() => <div>Hello second 2</div>).then(() => {
				rerender();
				expect(scratch.innerHTML).to.eql(
					`<div>Hello first 2</div><div><div>Hello second 2</div></div>`
				);
				expect(Suspender1.prototype.render).to.have.been.calledThrice;
				expect(Suspender2.prototype.render).to.have.been.calledThrice;
			});
		});
	});

	it('should support text directly under Suspense', () => {
		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				Text
				{/* Adding a <div> here will make things work... */}
				<Suspender />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`Text<div>Hello</div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return resolve(() => <div>Hello 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`Text<div>Hello 2</div>`
			);
		});
	});

	it('should support to change DOM tag directly under suspense', () => {

		/** @type {(state: {tag: string}) => void} */
		let setState;
		class StatefulComp extends Component {
			constructor(props) {
				super(props);
				setState = this.setState.bind(this);
				this.state = {
					tag: props.defaultTag
				};
			}
			render(props, { tag: Tag }) {
				return (
					<Tag>Stateful</Tag>
				);
			}
		}

		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<StatefulComp defaultTag="div" />
				<Suspender />
			</Suspense>
		), scratch);

		expect(scratch.innerHTML).to.eql(
			`<div>Stateful</div><div>Hello</div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		setState({ tag: 'article' });

		return resolve(() => <div>Hello 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`<article>Stateful</article><div>Hello 2</div>`
			);
		});
	});

	it('should only suspend the most inner Suspend', () => {
		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render(
			<Suspense fallback={<div>Suspended... 1</div>}>
				Not suspended...
				<Suspense fallback={<div>Suspended... 2</div>}>
					<Catcher>
						<Suspender />
					</Catcher>
				</Suspense>
			</Suspense>,
			scratch
		);

		expect(scratch.innerHTML).to.eql(
			`Not suspended...<div>Hello</div>`
		);

		const [resolve] = suspend();
		rerender();

		expect(scratch.innerHTML).to.eql(
			`Not suspended...<div>Suspended... 2</div>`
		);

		return resolve(() => <div>Hello 2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.eql(
				`Not suspended...<div>Hello 2</div>`
			);
		});
	});

	it('should throw when missing Suspense', () => {
		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render(
			<Catcher>
				<Suspender />
			</Catcher>,
			scratch,
		);
		rerender();
		expect(scratch.innerHTML).to.eql(
			`<div>Hello</div>`
		);

		suspend();
		rerender();
		expect(scratch.innerHTML).to.eql(
			`<div>Catcher did catch: {Promise}</div>`
		);
	});

	it('should throw when lazy\'s loader throws', () => {

		/** @type {() => Promise<any>} */
		let reject;
		const ThrowingLazy = lazy(() => {
			const prom = new Promise((res, rej) => {
				reject = () => {
					rej(new Error('Thrown in lazy\'s loader...'));
					return prom;
				};
			});

			return prom;
		});

		render((
			<Suspense fallback={<div>Suspended...</div>}>
				<Catcher>
					<ThrowingLazy />
				</Catcher>
			</Suspense>
		), scratch);
		rerender();

		expect(scratch.innerHTML).to.eql(
			`<div>Suspended...</div>`
		);

		return reject().then(
			() => { expect.fail('Suspended promises resolved instead of rejected.'); },
			() => {
				rerender();
				expect(scratch.innerHTML).to.eql(
					`<div>Catcher did catch: Thrown in lazy's loader...</div>`
				);
			});
	});

	it('should support null fallback', () => {
		const [Suspender, suspend] = createSuspender(() => <div>Hello</div>);

		render(
			<div id="wrapper">
				<Suspense fallback={null}>
					<div id="inner">
						<Suspender />
					</div>
				</Suspense>
			</div>,
			scratch
		);
		expect(scratch.innerHTML).to.equal(
			`<div id="wrapper"><div id="inner"><div>Hello</div></div></div>`
		);

		const [resolve] = suspend();
		rerender();
		expect(scratch.innerHTML).to.equal(`<div id="wrapper"></div>`);

		return resolve(() => <div>Hello2</div>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.equal(`<div id="wrapper"><div id="inner"><div>Hello2</div></div></div>`);
		});
	});

	it('should render through components using shouldComponentUpdate', () => {
		const [Suspender, suspend] = createSuspender(() => <i>-1</i>);

		class Blocker extends Component {
			shouldComponentUpdate() {
				return false;
			}
			render(props) {
				return (
					<b>
						<i>0</i>
						{props.children}
						<i>2</i>
					</b>
				);
			}
		}

		render(
			<Suspense fallback={<div>Suspended...</div>}>
				<Blocker>
					<Suspender />
				</Blocker>
			</Suspense>,
			scratch
		);
		expect(scratch.innerHTML).to.equal('<b><i>0</i><i>-1</i><i>2</i></b>');

		const [resolve] = suspend();
		rerender();
		expect(scratch.innerHTML).to.equal('<div>Suspended...</div>');

		return resolve(() => <i>1</i>).then(() => {
			rerender();
			expect(scratch.innerHTML).to.equal('<b><i>0</i><i>1</i><i>2</i></b>');
		});
	});
});
