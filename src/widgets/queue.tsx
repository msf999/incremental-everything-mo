import {
  DocumentViewer,
  renderWidget,
  usePlugin,
  useRunAsync,
  useTracker,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import React from 'react';
import { Reader } from '../components/Reader';
import { VideoViewer } from '../components/Video';
import { remToActionItemType } from '../lib/actionItems';
import { shouldHideIncEverythingKey } from '../lib/consts';
import { setCurrentIncrementalRem } from '../lib/currentRem';
import { useQueueCSS } from '../lib/hooks';

export function QueueComponent() {
  const plugin = usePlugin();
  useQueueCSS();
  const ctx = useRunAsync(
    async () => await plugin.widget.getWidgetContext<WidgetLocation.Flashcard>(),
    []
  );
  const remAndType = useTracker(
    async (rp) => {
      if (!ctx) {
        return undefined;
      }
      const rem = await rp.rem.findOne(ctx?.remId);
      if (!rem) {
        return null;
      }
      const ret = await remToActionItemType(rp, rem);
      return ret;
    },
    [ctx?.remId]
  );

  React.useEffect(() => {
    setCurrentIncrementalRem(plugin, remAndType?.rem?._id);
    if (remAndType === null) {
      plugin.queue.removeCurrentCardFromQueue(false);
    }
  }, [remAndType]);

  // Navigate to the rem when an incremental item is reached in the queue
  React.useEffect(() => {
    if (remAndType?.rem?._id) {
      // Navigate to the rem automatically when it appears in the queue
      plugin.window.openRem(remAndType.rem._id);
    }
  }, [remAndType?.rem?._id]);

  /**
   * If the rem is a rem type, then we should render the rem editor
   * if there are no other plugin widgets at this location
   */
  const shouldRenderEditorForRemType = useRunAsync(async () => {
    if (remAndType?.type !== 'rem') {
      return false;
    } else {
      const widgetsAtLocation = (
        await plugin.widget.getWidgetsAtLocation(WidgetLocation.Flashcard, remAndType.rem._id)
      ).filter((w) => w.pluginId !== 'incremental-everything');
      return widgetsAtLocation.length === 0;
    }
  }, [remAndType?.type, remAndType?.rem._id]);

  React.useEffect(() => {
    const shouldHide = remAndType?.type === 'rem' && !shouldRenderEditorForRemType
    plugin.storage.setSession(shouldHideIncEverythingKey, shouldHide);

    return () => {
      plugin.storage.setSession(shouldHideIncEverythingKey, false);
    };
  }, [remAndType?.type, shouldRenderEditorForRemType]);

  if (remAndType?.type === 'rem' && !shouldRenderEditorForRemType) {
    return null;
  }

  return (
    <div
      className="incremental-everything-element"
      style={{
        height: '100%',
      }}
    >
      <div
        className="box-border p-2"
        style={{
          height: `100%`,
        }}
      >
        {!remAndType ? null : remAndType.type === 'pdf' ||
          remAndType.type === 'html' ||
          remAndType.type === 'pdf-highlight' ||
          remAndType.type === 'html-highlight' ? (
          <Reader actionItem={remAndType} />
        ) : remAndType.type === 'youtube' ? (
          <VideoViewer actionItem={remAndType} />
        ) : remAndType.type === 'rem' ? (
          <DocumentViewer width={'100%'} height={'100%'} documentId={remAndType.rem._id} />
        ) : null}
        
        {/* Navigation indicator */}
        {remAndType?.rem?._id && (
          <div 
            className="fixed top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded text-xs cursor-pointer hover:bg-blue-600 transition-colors"
            onClick={() => plugin.window.openRem(remAndType.rem._id)}
            title="Click to navigate to the rem"
          >
            📍 Navigate to Rem
          </div>
        )}
      </div>
    </div>
  );
}

renderWidget(QueueComponent);
