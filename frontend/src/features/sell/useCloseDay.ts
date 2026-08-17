import { useCallback, useEffect, useRef, useState } from 'react';

import { closeCurrentDay, getCurrentCloseDayReport, getReportDays } from '../../api/reports';
import type { CloseDayClosure, CloseDayReport, ReportDaysResponse } from '../../types/reports';

interface CloseDayState {
  open: boolean;
  previewLoading: boolean;
  previewError: string;
  report: CloseDayReport | null;
  closedAt: string | null;
  closureStatusUnavailable: boolean;
  pending: boolean;
  mutationError: string;
  confirmation: CloseDayClosure | null;
}

const initialState: CloseDayState = {
  open: false,
  previewLoading: false,
  previewError: '',
  report: null,
  closedAt: null,
  closureStatusUnavailable: false,
  pending: false,
  mutationError: '',
  confirmation: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function closureForDate(days: ReportDaysResponse, date: string): string | null {
  return days.days.find((day) => day.date === date)?.closedAt ?? null;
}

export function useCloseDay(onConfirmed: () => void) {
  const [state, setState] = useState<CloseDayState>(initialState);
  const previewLocked = useRef(false);
  const mutationLocked = useRef(false);
  const mounted = useRef(true);
  const previewController = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewController.current?.abort();
    };
  }, []);

  const openPreview = useCallback(async () => {
    if (previewLocked.current || mutationLocked.current) return;
    previewLocked.current = true;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setState((current) => ({ ...current, previewLoading: true, previewError: '', mutationError: '', confirmation: null }));

    try {
      const report = await getCurrentCloseDayReport(controller.signal);
      let closedAt: string | null = null;
      let closureStatusUnavailable = false;
      try {
        const days = await getReportDays(controller.signal);
        closedAt = closureForDate(days, report.date);
      } catch {
        if (controller.signal.aborted) return;
        closureStatusUnavailable = true;
      }
      if (mounted.current && !controller.signal.aborted) {
        setState({
          open: true,
          previewLoading: false,
          previewError: '',
          report,
          closedAt,
          closureStatusUnavailable,
          pending: false,
          mutationError: '',
          confirmation: null,
        });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState((current) => ({
          ...current,
          previewLoading: false,
          previewError: errorMessage(error, 'ไม่สามารถสรุปยอดขายได้'),
        }));
      }
    } finally {
      previewLocked.current = false;
    }
  }, []);

  const closePreview = useCallback(() => {
    if (mutationLocked.current) return;
    setState((current) => ({ ...current, open: false, mutationError: '', confirmation: null }));
  }, []);

  const refreshConfirmedPreview = useCallback(async (confirmation: CloseDayClosure) => {
    const results = await Promise.allSettled([
      getCurrentCloseDayReport(),
      getReportDays(),
    ]);
    if (!mounted.current) return;
    setState((current) => {
      if (!current.open || current.confirmation?.closedAt !== confirmation.closedAt) return current;
      const report = results[0].status === 'fulfilled' ? results[0].value : current.report;
      const closedAt = results[1].status === 'fulfilled'
        ? closureForDate(results[1].value, confirmation.date) ?? confirmation.closedAt
        : confirmation.closedAt;
      return {
        ...current,
        report,
        closedAt,
        closureStatusUnavailable: results[1].status === 'rejected',
      };
    });
  }, []);

  const confirm = useCallback(async () => {
    if (mutationLocked.current || !state.report) return;
    mutationLocked.current = true;
    setState((current) => ({ ...current, pending: true, mutationError: '', confirmation: null }));

    try {
      const confirmation = await closeCurrentDay();
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        pending: false,
        closedAt: confirmation.closedAt,
        mutationError: '',
        confirmation,
      }));
      onConfirmed();
      void refreshConfirmedPreview(confirmation);
    } catch (error) {
      if (mounted.current) {
        setState((current) => ({
          ...current,
          pending: false,
          mutationError: errorMessage(error, 'ปิดยอดไม่สำเร็จ'),
          confirmation: null,
        }));
      }
    } finally {
      mutationLocked.current = false;
    }
  }, [onConfirmed, refreshConfirmedPreview, state.report]);

  return { ...state, openPreview, closePreview, confirm };
}
