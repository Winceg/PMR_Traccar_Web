import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { IconButton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip } from '@mui/material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import LocationSearchingIcon from '@mui/icons-material/LocationSearching';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ReportFilter, { updateReportParams } from './components/ReportFilter';
import { useTranslation } from '../common/components/LocalizationProvider';
import PageLayout from '../common/components/PageLayout';
import ReportsMenu from './components/ReportsMenu';
import PositionValue from '../common/components/PositionValue';
import ColumnSelect from './components/ColumnSelect';
import ResizeHandle from './components/ResizeHandle';
import usePositionAttributes from '../common/attributes/usePositionAttributes';
import { useCatch, useCatchCallback } from '../reactHelper';
import MapView from '../map/core/MapView';
import MapRoutePath from '../map/MapRoutePath';
import MapRoutePoints from '../map/MapRoutePoints';
import MapPositions from '../map/MapPositions';
import useReportStyles from './common/useReportStyles';
import TableShimmer from '../common/components/TableShimmer';
import MapCamera from '../map/MapCamera';
import MapGeofence from '../map/MapGeofence';
import scheduleReport from './common/scheduleReport';
import MapScale from '../map/MapScale';
import { useRestriction } from '../common/util/permissions';
import CollectionActions from '../settings/components/CollectionActions';
import fetchOrThrow from '../common/util/fetchOrThrow';
import SelectField from '../common/components/SelectField';
import { sessionActions } from '../store';

const DEFAULT_COLUMNS = ['fixTime', 'latitude', 'longitude', 'speed', 'address'];

const PositionsReportPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { classes } = useReportStyles();
  const t = useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();

  const positionAttributes = usePositionAttributes(t);

  const readonly = useRestriction('readonly');
  const user = useSelector((state) => state.session.user);

  const [available, setAvailable] = useState([]);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [items, setItems] = useState([]);
  const [reversed, setReversed] = useState(true);
  const geofenceId = searchParams.has('geofenceId')
    ? parseInt(searchParams.get('geofenceId'))
    : null;
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const saveColumns = useCallback(async (deviceId, newColumns) => {
    const key = `positionReportColumns_${deviceId}`;
    const updatedAttributes = { ...user.attributes, [key]: newColumns.join(',') };
    const response = await fetchOrThrow(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...user, attributes: updatedAttributes }),
    });
    dispatch(sessionActions.updateUser(await response.json()));
  }, [user, dispatch]);

  const [currentDeviceId, setCurrentDeviceId] = useState(null);

  const handleSetColumns = useCallback((newColumns) => {
    setColumns(newColumns);
    if (currentDeviceId) {
      saveColumns(currentDeviceId, newColumns).catch(() => {});
    }
  }, [currentDeviceId, saveColumns]);

  const selectedRef = useRef();

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selectedItem]);

  const onMapPointClick = useCallback(
    (positionId) => {
      setSelectedItem(items.find((it) => it.id === positionId));
    },
    [items, setSelectedItem],
  );

  const onShow = useCatchCallback(
    async ({ deviceIds, from, to }) => {
      const query = new URLSearchParams({ from, to });
      if (geofenceId) {
        query.append('geofenceId', geofenceId);
      }
      deviceIds.forEach((deviceId) => query.append('deviceId', deviceId));
      setLoading(true);
      try {
        const response = await fetchOrThrow(`/api/positions?${query.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        const data = await response.json();
        const keySet = new Set();
        const keyList = [];
        data.forEach((position) => {
          Object.keys(position).forEach((it) => keySet.add(it));
          Object.keys(position.attributes).forEach((it) => keySet.add(it));
        });
        ['id', 'deviceId', 'outdated', 'network', 'attributes'].forEach((key) =>
          keySet.delete(key),
        );
        Object.keys(positionAttributes).forEach((key) => {
          if (keySet.has(key)) {
            keyList.push(key);
            keySet.delete(key);
          }
        });
        setAvailable(
          [...keyList, ...keySet].map((key) => [key, positionAttributes[key]?.name || key]),
        );
        setItems(data);

        const deviceId = deviceIds[0];
        setCurrentDeviceId(deviceId);
        const saved = user.attributes[`positionReportColumns_${deviceId}`]
          || user.attributes.positionReportColumns;
        setColumns(saved ? saved.split(',') : DEFAULT_COLUMNS);
      } finally {
        setLoading(false);
      }
    },
    [geofenceId, positionAttributes, user.attributes],
  );

  const onExport = useCatch(async ({ deviceIds, from, to, format }) => {
    const query = new URLSearchParams({ from, to });
    if (geofenceId) {
      query.append('geofenceId', geofenceId);
    }
    deviceIds.forEach((deviceId) => query.append('deviceId', deviceId));
    window.location.assign(`/api/positions/${format}?${query.toString()}`);
  });

  const onSchedule = useCatch(async (deviceIds, groupIds, report) => {
    report.type = 'route';
    await scheduleReport(deviceIds, groupIds, report);
    navigate('/reports/scheduled');
  });

  return (
    <PageLayout menu={<ReportsMenu />} breadcrumbs={['reportTitle', 'reportPositions']}>
      <div className={classes.container}>
        {selectedItem && (
          <>
            <div className={classes.containerMap}>
              <MapView>
                <MapGeofence />
                {[...new Set(items.map((it) => it.deviceId))].map((deviceId) => {
                  const positions = items.filter((position) => position.deviceId === deviceId);
                  return (
                    <Fragment key={deviceId}>
                      <MapRoutePath positions={positions} />
                      <MapRoutePoints positions={positions} onClick={onMapPointClick} />
                    </Fragment>
                  );
                })}
                <MapPositions positions={[selectedItem]} titleField="fixTime" />
              </MapView>
              <MapScale />
              <MapCamera positions={items} />
            </div>
            <ResizeHandle />
          </>
        )}
        <div className={classes.containerMain}>
          <div className={classes.header}>
            <ReportFilter
              onShow={onShow}
              onExport={onExport}
              onSchedule={onSchedule}
              deviceType="single"
              loading={loading}
              formats={['csv', 'gpx', 'kml', 'kmz']}
            >
              <div className={classes.filterItem}>
                <SelectField
                  value={geofenceId}
                  onChange={(e) => {
                    const values = e.target.value ? [e.target.value] : [];
                    updateReportParams(searchParams, setSearchParams, 'geofenceId', values);
                  }}
                  endpoint="/api/geofences"
                  label={t('sharedGeofence')}
                  fullWidth
                />
              </div>
              <ColumnSelect
                columns={columns}
                setColumns={handleSetColumns}
                columnsArray={available}
                rawValues
                disabled={!items.length}
              />
            </ReportFilter>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell className={classes.columnAction} />
                {columns.map((key) => (
                  <TableCell key={key}>
                    {positionAttributes[key]?.name || key}
                    {key === 'fixTime' && (
                      <Tooltip title={reversed ? t('sharedSortAscending') : t('sharedSortDescending')}>
                        <IconButton size="small" onClick={() => setReversed((r) => !r)}>
                          {reversed ? <ArrowDownwardIcon fontSize="small" /> : <ArrowUpwardIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                ))}
                <TableCell className={classes.columnAction} />
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading ? (
                (reversed ? [...items].reverse() : items).slice(0, 4000).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className={classes.columnAction} padding="none">
                      {selectedItem === item ? (
                        <IconButton
                          size="small"
                          onClick={() => setSelectedItem(null)}
                          ref={selectedRef}
                        >
                          <GpsFixedIcon fontSize="small" />
                        </IconButton>
                      ) : (
                        <IconButton size="small" onClick={() => setSelectedItem(item)}>
                          <LocationSearchingIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                    {columns.map((key) => (
                      <TableCell key={key}>
                        <PositionValue
                          position={item}
                          property={item.hasOwnProperty(key) ? key : null}
                          attribute={item.hasOwnProperty(key) ? null : key}
                        />
                      </TableCell>
                    ))}
                    <TableCell className={classes.actionCellPadding}>
                      <CollectionActions
                        itemId={item.id}
                        endpoint="positions"
                        readonly={readonly}
                        onReload={() => {
                          setItems(items.filter((position) => position.id !== item.id));
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableShimmer columns={columns.length + 1} startAction />
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageLayout>
  );
};

export default PositionsReportPage;
