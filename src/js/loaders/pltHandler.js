
import { LEG_CAVE, STATION_NORMAL } from '../core/constants';
import { Tree } from '../core/Tree';
import { Vector3, Box3 } from '../Three';
import { StationPosition } from '../core/StationPosition';

const ftom = 12 * 0.0254;

function pltHandler ( fileName ) {

	this.fileName     = fileName;
	this.scraps       = [];
	this.faults       = [];
	this.groups       = [];
	this.xGroups      = [];
	this.xSects       = [];
	this.allStations  = [];
	this.surveyTree   = new Tree( '', 0 );
	this.limits       = new Box3();
	this.terrains     = [];
	this.hasTerrain   = false;
	this.modelOffset  = 0;
	this.messages     = 0;

}

pltHandler.prototype.constructor = pltHandler;

pltHandler.prototype.type = 'text';

pltHandler.prototype.parse = function ( dataStream, metadata, section ) {

	this.metadata = metadata;

	const groups      = this.groups;
	const surveyTree  = this.surveyTree;
	const xSects      = this.xSects;
	const limits      = this.limits;
	const stationMap  = new Map();
	const allStations = this.allStations;

	var path = [];
	var segments = [];
	var stationName;
	var surveyName;
	var surveyId = 0;
	var lastStationIndex = -1;

	const lines = dataStream.split( /[\n\r]+/ );

	const l = lines.length;
	var lrud, i, stationIndex, coords;

	for ( i = 0; i < l; i++ ) {

		const parts = lines[ i ].split( /\s+/ );

		const cmd = parts[ 0 ].charAt( 0 );

		switch ( cmd ) {

		case 'M': // move

			if ( segments.length > 1 ) groups.push( segments );

			segments = [];
			lastStationIndex = -1;

		case 'D': // eslint-disable-line no-fallthrough

			stationName = parts[ 4 ].substring( 1 );

			path[ 1 ] = stationName;

			coords = readCoords( parts );
			stationIndex = coords.stationIndex;

			segments.push( { coords: coords, type: LEG_CAVE, survey: surveyId } );

			if ( coords.connections === 0 ) surveyTree.addLeaf( path, { p: coords, type: STATION_NORMAL } );

			coords.connections++;

			if ( parts[ 5 ] === 'P' ) {

				lrud = {
					l: +parts[ 6 ] * ftom,
					u: +parts[ 7 ] * ftom,
					d: +parts[ 8 ] * ftom,
					r: +parts[ 9 ] * ftom
				};

				var from = ( lastStationIndex !== -1 ) ? allStations[ lastStationIndex ] : null;

				xSects.push( { m_from: lastStationIndex, m_to: stationIndex, start: from, end: coords, lrud: lrud, survey: surveyId, type: 2  } );

				lastStationIndex = stationIndex;
			}

			break;

		case 'N': // line survey

			surveyName = parts[ 0 ].substring( 1 );

			path = [ surveyName ];
			surveyId = surveyTree.addPath( surveyName ).id;

			break;

		case 'Z': // end of survey

			/*
			limits.min.set(
				+parts[ 3 ],
				+parts[ 1 ],
				+parts[ 5 ]
			);

			limits.max.set(
				+parts[ 4 ],
				+parts[ 2 ],
				+parts[ 6 ]
			);
			*/

			break;

		case 'F': // feature survey
		case 'L': // feature location
		case 'X': // end of survey
		case 'O': // Datum
		case 'G': // UTM Zone

			break;

		case 'S':

			console.log( 'section name', lines[ 1 ].substring( 1 ) );
			break;

		default:

			console.log( 'unknown command ', parts[ 0 ] );

		}

	}

	if ( segments.length > 1 ) groups.push( segments );

	return this;

	function readCoords( parts ) {

		const lastKey = parts[ 1 ] + ':' + parts[ 2 ] + ':' + parts[ 3 ];
		const cachedCoords = stationMap.get( lastKey );

		var coords;

		if ( cachedCoords !== undefined ) {

			coords = cachedCoords;

		} else {

			coords = new StationPosition(
				+parts[ 2 ] * ftom,
				+parts[ 1 ] * ftom,
				+parts[ 3 ] * ftom
			);


			coords.stationIndex = allStations.length;

			allStations.push( coords );
			stationMap.set( lastKey, coords );

			limits.expandByPoint( coords );

		}

		return coords;

	}

};

pltHandler.prototype.getLineSegments = function () {

	const lineSegments = [];
	const groups = this.groups;

	for ( var i = 0, l = groups.length; i < l; i++ ) {

		const g = groups[ i ];

		for ( var v = 0, vMax = g.length - 1; v < vMax; v++ ) {

			// create vertex pairs for each line segment.
			// all vertices except first and last are duplicated.
			const from = g[ v ];
			const to   = g[ v + 1 ];

			const fromCoords = from.coords;
			const toCoords = to.coords;

			lineSegments.push( { from: fromCoords, to: toCoords, type: to.type, survey: to.survey } );

		}

	}

	return lineSegments;

};

pltHandler.prototype.end = function () {

	const self = this;
	const allStations = this.allStations;
	const offsets = this.limits.getCenter( new Vector3() );

	this.offsets = offsets;

	// convert to origin centered coordinates

	allStations.forEach( function ( s ) {

		s.sub( offsets );

	} );

	procXsects();

	return this;

	function procXsects () {

		const xGroups = self.xGroups;
		const xSects  = self.xSects;
		const ends = [];

		var lastTo, xGroup, i;

		xSects.sort( function ( a, b ) { return a.m_from - b.m_from; } );

		for ( i = 0; i < xSects.length; i++ ) {

			const xSect = xSects[ i ];

			if ( xSect.m_from !== lastTo ) {

				xGroup = [];
				xGroups.push( xGroup );

			}

			lastTo = xSect.m_to;

			xGroup.push( xSect );

		}

		for ( i = 0; i < xGroups.length; i++ ) {

			const group = xGroups[ i ];

			const start = group[ 0 ].m_from;
			const end = group[ group.length - 1 ].m_to;

			// concatenate adjacent groups

			const prepend = ends.indexOf( start );

			if ( prepend !== -1 ) {

				// keep the new run in the same slot - thus end record remains correct
				xGroups[ i ] = xGroups[ prepend ].concat( group );

				// remove entry from moved group
				xGroups[ prepend ] = [];
				ends[ prepend ] = undefined;

			}

			ends.push( end );

		}

		for ( i = 0; i < xGroups.length; i++ ) {

			const group = xGroups[ i ];
			const xSect = group[ 0 ];

			if ( xSect === undefined ) continue; // groups that have been merged

			const start = xSect.start;
			const end = xSect.end;
			group.shift();
			// fake approach vector for initial xSect ( mirrors first segment vector )

//			const newStart = new Vector3().copy( start ).multiplyScalar( 2 ).sub( end );

//			group.unshift( { start: newStart, end: start, lrud: xSect.fromLRUD, survey: xSect.survey, type: xSect.type } );

		}

	}

};

pltHandler.prototype.getSurvey = function () {

	return {
		title: this.fileName,
		surveyTree: this.surveyTree,
		sourceCRS: null,
		targetCRS: null,
		lineSegments: this.getLineSegments(),
		crossSections: this.xGroups,
		scraps: [],
		hasTerrain: false,
		metadata: this.metadata,
		limits: this.limits,
		offsets: this.offsets
	};

};

export { pltHandler };

// EOF