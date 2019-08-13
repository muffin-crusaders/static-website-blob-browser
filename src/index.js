import React from 'react';
import { render } from 'react-dom';
import moment from 'moment';
import _ from 'lodash';
import './index.css';

// This sample uses React Table
// Check it out at https://react-table.js.org/#/story/readme
import ReactTable from 'react-table';
import 'react-table/react-table.css';

// Import Azure Storage Blob SDK
import { Aborter, ServiceURL, ContainerURL, StorageURL, AnonymousCredential } from '@azure/storage-blob';

// Account name, and the container to list from
const account = 'rampdemoblobstorage008';
const container = '$web';

class App extends React.Component {
    prefetchedBlobs = {};
    tableState = {};

    constructor() {
        super();
        this.state = {
            data: [],
            pages: 2,
            markers: [],
            loading: true,
            prefix: ''
        };

        this.onTableMount = state => {
            // NOTE: I couldn't figure out a better way to pass table state to the `fetchBlobs` when a link in the table cell is clicked
            // TODO: find a way around storing state explicitly
            this.tableState = state;

            this.listBlobs(this.tableState, this.prefix);
        };

        // catch back/forward browser button clicks
        window.onpopstate = event => {
            this.listBlobs(this.tableState, this.prefix);
        };
    }

    get prefix() {
        // Fetch the prefix in the query params to browse into folders
        const urlParams = new URLSearchParams(window.location.search);

        let prefix = window.location.pathname !== '/' ? window.location.pathname.slice(1) : urlParams.get('prefix');
        if (prefix !== null && prefix.length > 0 && prefix.slice(-1) !== '/') {
            prefix += '/';
        }

        window.history.pushState(null, '', window.location.origin);

        return prefix;
    }

    fetchBlobs(state, prefix = '') {
        if (this.prefetchedBlobs[prefix]) {
            return this.prefetchedBlobs[prefix];
        }

        // Use AnonymousCredential since $web container is made a 'public container'
        // and does not require authorization
        const anonymousCredential = new AnonymousCredential();
        const pipeline = StorageURL.newPipeline(anonymousCredential);

        const serviceURL = new ServiceURL(`https://${account}.blob.core.windows.net`, pipeline);

        // If you are using a SAS token, simply append to ContainerURL here.
        // We will use anonymous access hence no SAS token
        const containerName = container; //+ `?st=2018-11-06T06%3A15%3A24Z&se=2019-11-07T06%3A15%3A00Z&sp=rl&sv=2018-03-28&sr=c&sig=4vCT7aInDWRiypkuYlezN8dos0K2h2DvQ0pnNkMJSFs%3D`;
        const containerURL = ContainerURL.fromServiceURL(serviceURL, containerName);

        // List objects from Blob storage using the prefix
        // Delimiter for virtual directories is a forward slash '/' here
        const fetchPromise = containerURL.listBlobHierarchySegment(Aborter.none, '/', undefined, {
            maxresults: state.pageSize,
            prefix: prefix
        });

        this.prefetchedBlobs[prefix] = fetchPromise;

        return fetchPromise;
    }

    listBlobs(state, prefix, pushUrl = `?prefix=${prefix}`) {
        // this lists Blobs in pages defined in state.pageSize
        this.setState({ loading: true });

        // Push the new state into the url
        // if (pushUrl) {
        window.history.pushState(null, '', pushUrl);
        // }

        // fetch blob lists referenced by breadcrumbs
        const prefixParts = (prefix || '')
            .split('/')
            .filter(a => a)
            .slice(0, -1);

        // load blob lists from the breadcrumb folders
        if (prefixParts.length > 0) {
            prefixParts.map((step, index) => this.fetchBlobs(state, prefixParts.slice(0, index + 1).join('/')));
        }

        // List objects from Blob storage using the prefix
        // Delimiter for virtual directories is a forward slash '/' here
        this.fetchBlobs(state, prefix).then(res => {
            // Store the nextMarker in an array for prev/next buttons only if there are more blobs to show
            const markers = state.markers.slice();
            var totalPages = state.page + 1;
            if (res.nextMarker) {
                markers[state.page + 1] = res.nextMarker;
                totalPages++;
            }

            // Combine the found virtual directories and files
            // move folders to the top of the list
            const allBlobItems = [...res.segment.blobPrefixes, ...res.segment.blobItems];

            // load blob list from all the visible folder
            res.segment.blobPrefixes.forEach(blobPrefix => this.fetchBlobs(state, blobPrefix.name));
            console.log(this.prefetchedBlobs);

            // This is to sort rows, and handles blobName, contentLength and lastModified time
            const sortedData = _.orderBy(
                allBlobItems.filter(bi => bi.name !== 'view/'), // the source of this viewer is in the 'view/' folder, so we exclude it
                state.sorted.map(sort => {
                    return row => {
                        if (row[sort.id] === null) {
                            return -Infinity;
                        } // TODO: following is a workaround to special case contentLength and lastModified
                        else if (row[sort.id] === undefined) {
                            if (row.properties === undefined) {
                                return -Infinity;
                            } else {
                                return row.properties[sort.id];
                            }
                        }
                        return typeof row[sort.id] === 'string' ? row[sort.id].toLowerCase() : row[sort.id];
                    };
                }),
                state.sorted.map(d => (d.desc ? 'desc' : 'asc'))
            );

            // Store the state
            this.setState({
                data: sortedData,
                pages: totalPages,
                markers: markers,
                loading: false,
                prefix: prefix
            });
        });
    }

    // Custom links for various scenarios (handles blobs, directories and go back link)
    renderLink(blobName) {
        let link;
        const { prefix } = this.state;
        let folderName = null;
        let isFolder = true;

        if (blobName === '../') {
            // level up
            // link = '/';

            const prePrefix = prefix
                .split('/')
                .slice(0, -2)
                .join('/');

            link = prePrefix === '' ? '/' : '?prefix=' + prePrefix;
            folderName = prePrefix === '' ? null : prePrefix + '/';
        } else if (blobName.slice(-1) === '/') {
            // folder
            link = '?prefix=' + blobName;
            folderName = blobName;
            blobName = blobName.split('/').slice(-2, -1) + '/';
        } else {
            // file
            isFolder = false;
            link = '/' + blobName;
            blobName = blobName.split('/').pop();
        }

        return (
            <a
                href={window.location.origin + link}
                onClick={e => {
                    if (!isFolder) {
                        return;
                    }

                    e.preventDefault();
                    this.listBlobs(this.tableState, folderName, link);
                }}
            >
                {blobName}
            </a>
        );
    }

    render() {
        const { data, pages, markers, loading, prefix } = this.state;

        // If this is a directory view, add a go back link for the root
        var dataset = data;
        if (prefix !== null && prefix !== '') {
            dataset = [{ name: '../' }].concat(dataset);
        }

        return (
            <div>
                <Breadcrumbs path={prefix} onClick={(prefix, link) => this.listBlobs(this.tableState, prefix, link)} />

                <ReactTable
                    columns={[
                        {
                            Header: 'Blob Name',
                            id: 'name',
                            accessor: 'name',
                            Cell: ({ value }) => this.renderLink(value)
                        },
                        {
                            Header: 'Last Modified',
                            id: 'lastModified',
                            accessor: d => {
                                if (typeof d.properties !== 'undefined') {
                                    return moment(d.properties.lastModified.toISOString());
                                }
                            },
                            Cell: row =>
                                row.value ? (
                                    <span title={row.value.format('YYYY-MM-DD hh:mm:ss')}>{row.value.fromNow()}</span>
                                ) : null,
                            maxWidth: 400
                        },
                        {
                            Header: 'Content Length',
                            id: 'contentLength',
                            accessor: d => {
                                if (typeof d.properties !== 'undefined') {
                                    return d.properties.contentLength;
                                }
                            },
                            maxWidth: 200
                        }
                    ]}
                    manual // Do not paginate as we can only list objects in pages from Blob storage
                    data={dataset}
                    pages={pages}
                    minRows={0}
                    markers={markers}
                    loading={loading}
                    onFetchData={this.onTableMount}
                    showPagination={pages !== 1}
                    pageSizeOptions={[5000]}
                    defaultPageSize={5000}
                    showPageSizeOptions={false}
                    className="-striped -highlight"
                />
            </div>
        );
    }
}

class Breadcrumbs extends React.Component {
    render() {
        const pathSteps = (this.props.path || '').split('/').filter(a => a);

        // add link to the root
        const crumbs = [
            <React.Fragment key="root">
                <a
                    href={window.location.origin}
                    onClick={e => {
                        e.preventDefault();
                        // this will load the root blobs
                        this.props.onClick(null, '/');
                    }}
                >
                    root
                </a>
                <span> / </span>
            </React.Fragment>
        ];

        // create links for all breadcrumbs save the last one
        if (pathSteps.length > 0) {
            crumbs.push(
                ...pathSteps.slice(0, -1).map((step, index) => {
                    const prefix = `${pathSteps.slice(0, index + 1).join('/')}/`;
                    const link = `?prefix=${prefix}`;
                    return (
                        <React.Fragment key={step}>
                            <a
                                href={`${window.location.origin}${link}`}
                                onClick={e => {
                                    e.preventDefault();
                                    this.props.onClick(prefix, link);
                                }}
                            >
                                {step}
                            </a>
                            <span> / </span>
                        </React.Fragment>
                    );
                })
            );

            // add the last breadcrumb as a simple span
            crumbs.push(<span key="current">{pathSteps.slice(-1)}</span>);
        }

        return <h1>Index of {crumbs}</h1>;
    }
}

render(<App />, document.getElementById('root'));
